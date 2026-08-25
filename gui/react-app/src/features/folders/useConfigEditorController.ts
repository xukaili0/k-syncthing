import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { deleteJSON, getJSON, postJSON, putJSON, type DeviceConfig, type DiscoveryCacheResponse, type FolderConfig, type IgnoreResponse, type PendingDevicesResponse, type PendingFoldersResponse } from "../../api";
import { deviceName, folderLabel } from "../../components/review/review-formatters";
import type { DeviceShareDraft } from "../devices/DeviceSettingsPanel";
import { buildFolderPayload, normalizeIgnoreText, prepareFolderDraft } from "./folder-editor-utils";

type ConfigEditorControllerOptions = {
  folders: FolderConfig[];
  allDevices: DeviceConfig[];
  selectedFolder: FolderConfig | null;
  pendingFolders: PendingFoldersResponse;
  loadBootstrap: () => Promise<void>;
  setSelectedFolderId: Dispatch<SetStateAction<string>>;
  setOverviewMessage: Dispatch<SetStateAction<string>>;
  setOptionsSaveMessage: Dispatch<SetStateAction<string>>;
  setSettingsModalOpen: Dispatch<SetStateAction<boolean>>;
};

function cloneJSON<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function useConfigEditorController({
  folders,
  allDevices,
  selectedFolder,
  pendingFolders,
  loadBootstrap,
  setSelectedFolderId,
  setOverviewMessage,
  setOptionsSaveMessage,
  setSettingsModalOpen,
}: ConfigEditorControllerOptions) {
  const [folderEditorOpen, setFolderEditorOpen] = useState(false);
  const [folderDraft, setFolderDraft] = useState<FolderConfig | null>(null);
  const [folderIgnoreText, setFolderIgnoreText] = useState("");
  const [folderIgnoreError, setFolderIgnoreError] = useState("");
  const [folderIgnoreBusy, setFolderIgnoreBusy] = useState(false);
  const [folderAddIgnores, setFolderAddIgnores] = useState(false);
  const [folderSaveBusy, setFolderSaveBusy] = useState(false);
  const [folderSaveMessage, setFolderSaveMessage] = useState("");
  const [newFolderBusy, setNewFolderBusy] = useState(false);

  const [deviceEditorId, setDeviceEditorId] = useState("");
  const [deviceDraft, setDeviceDraft] = useState<DeviceConfig | null>(null);
  const [deviceShareDraft, setDeviceShareDraft] = useState<DeviceShareDraft>({ selected: {}, encryptionPasswords: {} });
  const [deviceSaveBusy, setDeviceSaveBusy] = useState(false);
  const [deviceSaveMessage, setDeviceSaveMessage] = useState("");
  const [newDeviceBusy, setNewDeviceBusy] = useState(false);

  const [discoveryCache, setDiscoveryCache] = useState<DiscoveryCacheResponse>({});
  const [pendingDevicesList, setPendingDevicesList] = useState<PendingDevicesResponse>({});

  const editingDevice = useMemo(
    () => allDevices.find((device) => device.deviceID === deviceEditorId) ?? null,
    [allDevices, deviceEditorId],
  );
  const editingExistingDevice = Boolean(editingDevice);
  const editingNewDevice = Boolean(deviceDraft && deviceEditorId === "__new__");
  const editingExistingFolder = Boolean(selectedFolder && folderDraft && folderDraft.id === selectedFolder.id);
  const editingNewFolder = Boolean(folderDraft && (!selectedFolder || folderDraft.id !== selectedFolder.id));

  const buildDeviceShareDraft = useCallback(
    (deviceID: string): DeviceShareDraft => {
      const selected: Record<string, boolean> = {};
      const encryptionPasswords: Record<string, string> = {};
      for (const folder of folders) {
        const folderDevice = (folder.devices ?? []).find((item) => item.deviceID === deviceID);
        if (folderDevice) {
          selected[folder.id] = true;
          encryptionPasswords[folder.id] = folderDevice.encryptionPassword ?? "";
        }
      }
      return { selected, encryptionPasswords };
    },
    [folders],
  );

  const syncDeviceFolderSharing = useCallback(
    async (deviceID: string, sharingDraft: DeviceShareDraft, untrusted: boolean) => {
      for (const folder of folders) {
        const current = cloneJSON(folder);
        const existingIndex = (current.devices ?? []).findIndex((item) => item.deviceID === deviceID);
        const shouldShare = Boolean(sharingDraft.selected[folder.id]);
        let changed = false;

        if (shouldShare) {
          const nextFolderDevice = {
            deviceID,
            ...(untrusted && sharingDraft.encryptionPasswords[folder.id]
              ? { encryptionPassword: sharingDraft.encryptionPasswords[folder.id] }
              : {}),
          };
          if (existingIndex === -1) {
            current.devices = [...(current.devices ?? []), nextFolderDevice];
            changed = true;
          } else {
            const existing = current.devices[existingIndex];
            const nextPassword = nextFolderDevice.encryptionPassword ?? "";
            const oldPassword = existing.encryptionPassword ?? "";
            if (oldPassword !== nextPassword) {
              current.devices = current.devices.map((item, index) =>
                index === existingIndex ? { ...item, encryptionPassword: nextPassword || undefined } : item,
              );
              changed = true;
            }
          }
        } else if (existingIndex !== -1) {
          current.devices = current.devices.filter((item) => item.deviceID !== deviceID);
          changed = true;
        }

        if (changed) {
          await putJSON(`/rest/config/folders/${encodeURIComponent(folder.id)}`, current);
        }
      }
    },
    [folders],
  );

  const loadFolderIgnores = async (folderId: string) => {
    setFolderIgnoreBusy(true);
    setFolderIgnoreError("");
    try {
      const response = await getJSON<IgnoreResponse>(`/rest/db/ignores?folder=${encodeURIComponent(folderId)}`);
      setFolderIgnoreText((response.ignore ?? []).join("\n"));
      setFolderIgnoreError(response.error ?? "");
    } catch (error) {
      setFolderIgnoreText("");
      setFolderIgnoreError(error instanceof Error ? error.message : "加载忽略模式失败");
    } finally {
      setFolderIgnoreBusy(false);
    }
  };

  const openFolderEditor = () => {
    if (!selectedFolder) {
      return;
    }
    setFolderDraft(prepareFolderDraft(selectedFolder));
    setFolderIgnoreText("");
    setFolderAddIgnores(false);
    void loadFolderIgnores(selectedFolder.id);
    setFolderSaveMessage("");
    setFolderEditorOpen(true);
  };

  const closeFolderEditor = () => {
    setFolderEditorOpen(false);
    setFolderDraft(null);
    setFolderIgnoreText("");
    setFolderIgnoreError("");
    setFolderIgnoreBusy(false);
    setFolderAddIgnores(false);
    setFolderSaveMessage("");
  };

  const openDeviceEditor = (device: DeviceConfig) => {
    setDeviceEditorId(device.deviceID);
    setDeviceDraft(cloneJSON(device));
    setDeviceShareDraft(buildDeviceShareDraft(device.deviceID));
    setDeviceSaveMessage("");
  };

  const closeDeviceEditor = () => {
    setDeviceEditorId("");
    setDeviceDraft(null);
    setDeviceShareDraft({ selected: {}, encryptionPasswords: {} });
    setDeviceSaveMessage("");
  };

  const toggleFolderPaused = async (folder: FolderConfig) => {
    const next = prepareFolderDraft(folder);
    next.paused = !folder.paused;
    try {
      await putJSON(`/rest/config/folders/${encodeURIComponent(folder.id)}`, buildFolderPayload(next));
      setOverviewMessage(next.paused ? `已暂停文件夹"${folderLabel(folder)}"。` : `已恢复文件夹"${folderLabel(folder)}"。`);
      await loadBootstrap();
    } catch (error) {
      setOverviewMessage(error instanceof Error ? error.message : "切换文件夹暂停状态失败");
    }
  };

  const saveFolderDraft = async () => {
    if (!selectedFolder || !folderDraft) {
      return;
    }
    setFolderSaveBusy(true);
    setFolderSaveMessage("");
    try {
      const payload = buildFolderPayload(folderDraft);
      await putJSON(`/rest/config/folders/${encodeURIComponent(selectedFolder.id)}`, payload);
      await postJSON(`/rest/db/ignores?folder=${encodeURIComponent(selectedFolder.id)}`, {
        ignore: normalizeIgnoreText(folderIgnoreText).split("\n"),
      });
      setFolderSaveMessage("文件夹设置已保存。");
      await loadBootstrap();
      closeFolderEditor();
    } catch (error) {
      setFolderSaveMessage(error instanceof Error ? error.message : "保存文件夹设置失败");
    } finally {
      setFolderSaveBusy(false);
    }
  };

  const deleteCurrentFolder = async () => {
    if (!selectedFolder || !window.confirm(`确认删除文件夹"${folderLabel(selectedFolder)}"的配置吗？`)) {
      return;
    }
    setFolderSaveBusy(true);
    setFolderSaveMessage("");
    try {
      await deleteJSON(`/rest/config/folders/${encodeURIComponent(selectedFolder.id)}`);
      closeFolderEditor();
      await loadBootstrap();
    } catch (error) {
      setFolderSaveMessage(error instanceof Error ? error.message : "删除文件夹配置失败");
    } finally {
      setFolderSaveBusy(false);
    }
  };

  const saveDeviceDraft = async () => {
    if (!editingDevice || !deviceDraft) {
      return;
    }
    setDeviceSaveBusy(true);
    setDeviceSaveMessage("");
    try {
      const payload = cloneJSON(deviceDraft);
      payload.addresses = (payload.addresses ?? []).filter((value) => value.trim().length > 0);
      payload.allowedNetworks = (payload.allowedNetworks ?? []).filter((value) => value.trim().length > 0);
      await putJSON(`/rest/config/devices/${encodeURIComponent(editingDevice.deviceID)}`, payload);
      await syncDeviceFolderSharing(editingDevice.deviceID, deviceShareDraft, Boolean(payload.untrusted));
      setDeviceSaveMessage("设备设置已保存。");
      await loadBootstrap();
      closeDeviceEditor();
    } catch (error) {
      setDeviceSaveMessage(error instanceof Error ? error.message : "保存设备设置失败");
    } finally {
      setDeviceSaveBusy(false);
    }
  };

  const deleteCurrentDevice = async () => {
    if (!editingDevice || !window.confirm(`确认删除设备"${deviceName(editingDevice)}"的配置吗？`)) {
      return;
    }
    setDeviceSaveBusy(true);
    setDeviceSaveMessage("");
    try {
      await deleteJSON(`/rest/config/devices/${encodeURIComponent(editingDevice.deviceID)}`);
      closeDeviceEditor();
      await loadBootstrap();
    } catch (error) {
      setDeviceSaveMessage(error instanceof Error ? error.message : "删除设备配置失败");
    } finally {
      setDeviceSaveBusy(false);
    }
  };

  const createFolder = async () => {
    setNewFolderBusy(true);
    setOptionsSaveMessage("");
    try {
      const defaults = await getJSON<FolderConfig>("/rest/config/defaults/folder");
      const nextFolder: FolderConfig = prepareFolderDraft({
        ...cloneJSON(defaults),
        id: `folder-${Date.now()}`,
        label: "新文件夹",
        path: "",
        devices: [],
        type: "sendreceive",
      });
      setFolderDraft(nextFolder);
      setFolderIgnoreText("");
      setFolderIgnoreError("");
      setFolderAddIgnores(false);
      setFolderEditorOpen(true);
      setSettingsModalOpen(false);
    } catch (error) {
      setOptionsSaveMessage(error instanceof Error ? error.message : "打开新文件夹表单失败");
    } finally {
      setNewFolderBusy(false);
    }
  };

  const createDevice = async () => {
    setNewDeviceBusy(true);
    setOptionsSaveMessage("");
    try {
      const [defaults, discovery, pending] = await Promise.all([
        getJSON<DeviceConfig>("/rest/config/defaults/device"),
        getJSON<DiscoveryCacheResponse>("/rest/system/discovery").catch(() => ({})),
        getJSON<PendingDevicesResponse>("/rest/cluster/pending/devices").catch(() => ({})),
      ]);
      const nextDevice: DeviceConfig = {
        ...cloneJSON(defaults),
        deviceID: "",
        name: "新设备",
        addresses: defaults.addresses?.length ? defaults.addresses : ["dynamic"],
      };
      setDeviceEditorId("__new__");
      setDeviceDraft(nextDevice);
      setDeviceShareDraft({ selected: {}, encryptionPasswords: {} });
      setDiscoveryCache(discovery);
      setPendingDevicesList(pending);
      setSettingsModalOpen(false);
    } catch (error) {
      setOptionsSaveMessage(error instanceof Error ? error.message : "打开新设备表单失败");
    } finally {
      setNewDeviceBusy(false);
    }
  };

  const saveNewFolder = async () => {
    if (!folderDraft) {
      return;
    }
    setFolderSaveBusy(true);
    setFolderSaveMessage("");
    try {
      const payload = buildFolderPayload(folderDraft);
      await postJSON("/rest/config/folders", payload);
      if (folderAddIgnores && normalizeIgnoreText(folderIgnoreText).trim().length > 0) {
        await postJSON(`/rest/db/ignores?folder=${encodeURIComponent(payload.id)}`, {
          ignore: normalizeIgnoreText(folderIgnoreText).split("\n"),
        });
      }
      await loadBootstrap();
      setSelectedFolderId(payload.id);
      closeFolderEditor();
    } catch (error) {
      setFolderSaveMessage(error instanceof Error ? error.message : "创建文件夹失败");
    } finally {
      setFolderSaveBusy(false);
    }
  };

  const saveNewDevice = async () => {
    if (!deviceDraft) {
      return;
    }
    setDeviceSaveBusy(true);
    setDeviceSaveMessage("");
    try {
      const payload = cloneJSON(deviceDraft);
      payload.addresses = (payload.addresses ?? []).filter((value) => value.trim().length > 0);
      payload.allowedNetworks = (payload.allowedNetworks ?? []).filter((value) => value.trim().length > 0);
      await postJSON("/rest/config/devices", payload);
      await syncDeviceFolderSharing(payload.deviceID, deviceShareDraft, Boolean(payload.untrusted));
      await loadBootstrap();
      closeDeviceEditor();
    } catch (error) {
      setDeviceSaveMessage(error instanceof Error ? error.message : "创建设备失败");
    } finally {
      setDeviceSaveBusy(false);
    }
  };

  const acceptPendingFolder = async (folderId: string, deviceId: string) => {
    setNewFolderBusy(true);
    setOptionsSaveMessage("");
    try {
      const defaults = await getJSON<FolderConfig>("/rest/config/defaults/folder");
      const pending = pendingFolders[folderId];
      const offeredBy = pending?.offeredBy?.[deviceId];
      const nextFolder = prepareFolderDraft({
        ...cloneJSON(defaults),
        id: folderId,
        label: offeredBy?.label || folderId,
        path: "",
        devices: [{ deviceID: deviceId }],
        type: offeredBy?.receiveEncrypted ? "receiveencrypted" : "sendreceive",
      });
      setFolderDraft(nextFolder);
      setFolderIgnoreText("");
      setFolderIgnoreError("");
      setFolderAddIgnores(false);
      setFolderSaveMessage("");
      setFolderEditorOpen(true);
      setSettingsModalOpen(false);
    } catch (error) {
      setOptionsSaveMessage(error instanceof Error ? error.message : "打开待接受文件夹表单失败");
    } finally {
      setNewFolderBusy(false);
    }
  };

  const dismissPendingFolder = async (folderId: string, deviceId?: string) => {
    try {
      const query = new URLSearchParams({ folder: folderId });
      if (deviceId) {
        query.set("device", deviceId);
      }
      await deleteJSON(`/rest/cluster/pending/folders?${query.toString()}`);
      await loadBootstrap();
    } catch (error) {
      setOptionsSaveMessage(error instanceof Error ? error.message : "忽略待接受文件夹失败");
    }
  };


  return {
    state: {
      folderEditorOpen,
      folderDraft,
      folderIgnoreText,
      folderIgnoreError,
      folderIgnoreBusy,
      folderAddIgnores,
      folderSaveBusy,
      folderSaveMessage,
      newFolderBusy,
      deviceEditorId,
      deviceDraft,
      deviceShareDraft,
      deviceSaveBusy,
      deviceSaveMessage,
      newDeviceBusy,
      discoveryCache,
      pendingDevicesList,
      editingExistingDevice,
      editingNewDevice,
      editingExistingFolder,
      editingNewFolder,
    },
    actions: {
      setFolderEditorOpen,
      setFolderDraft,
      setFolderIgnoreText,
      setFolderIgnoreError,
      setFolderAddIgnores,
      setFolderSaveMessage,
      setDeviceDraft,
      setDeviceShareDraft,
      loadFolderIgnores,
      openFolderEditor,
      closeFolderEditor,
      openDeviceEditor,
      closeDeviceEditor,
      toggleFolderPaused,
      saveFolderDraft,
      deleteCurrentFolder,
      saveDeviceDraft,
      deleteCurrentDevice,
      createFolder,
      createDevice,
      saveNewFolder,
      saveNewDevice,
      acceptPendingFolder,
      dismissPendingFolder,
    },
  };
}
