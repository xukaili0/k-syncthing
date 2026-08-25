import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ConfigResponse } from "./api";
import {
  AdvancedConfigGroup,
  FieldMeta,
  decodeSimpleList,
  editableEntries,
  encodeSimpleList,
  fieldMetaFor,
  generateAPIKey,
  setConfigValue,
  validateAdvancedConfig,
} from "./advanced-config-model";
import PerformanceSettingsPanel from "./features/settings/PerformanceSettingsPanel";

type ConfigPath = Array<string | number>;

type AdvancedConfigModalProps = {
  config: ConfigResponse;
  themes: string[];
  busy: boolean;
  message: string;
  restartRequired: boolean;
  onChange: (config: ConfigResponse) => void;
  onSave: () => void;
  onClose: () => void;
};

function HelpTooltip(props: { meta: FieldMeta }) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className="config-help"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="config-help-button"
        aria-label={`查看“${props.meta.label}”的说明`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
      {open && (
        <span className="config-help-popup" id={id} role="tooltip">
          <span>{props.meta.description}</span>
          <a href={props.meta.docsURL} target="_blank" rel="noreferrer">
            查看官方配置文档
          </a>
        </span>
      )}
    </span>
  );
}

function FieldLabel(props: { meta: FieldMeta; fieldKey: string }) {
  return (
    <span className="advanced-field-label">
      <span>
        {props.meta.label}
        <code>{props.fieldKey}</code>
      </span>
      <HelpTooltip meta={props.meta} />
    </span>
  );
}

function NumberInput(props: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(props.value));

  useEffect(() => {
    setDraft(String(props.value));
  }, [props.value]);

  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) {
      props.onChange(parsed);
    } else {
      setDraft(String(props.value));
    }
  };

  return (
    <input
      type="number"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function ListInput(props: { value: unknown[]; preserveEmpty?: boolean; onChange: (value: unknown[]) => void }) {
  const [draft, setDraft] = useState(encodeSimpleList(props.value));

  useEffect(() => {
    setDraft(encodeSimpleList(props.value));
  }, [props.value]);

  const commit = (nextDraft: string) => {
    if (props.preserveEmpty) {
      props.onChange(nextDraft.split(/\r?\n/));
    } else {
      props.onChange(decodeSimpleList(nextDraft, props.value));
    }
  };

  return (
    <textarea
      rows={4}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => commit(draft)}
    />
  );
}

function SizeInput(props: {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}) {
  const value = typeof props.value.value === "number" ? props.value.value : 0;
  const unit = typeof props.value.unit === "string" ? props.value.unit : "%";
  return (
    <div className="inline-field">
      <NumberInput value={value} onChange={(nextValue) => props.onChange({ ...props.value, value: nextValue })} />
      <select value={unit} onChange={(event) => props.onChange({ ...props.value, unit: event.target.value })}>
        <option value="%">%</option>
        <option value="kB">kB</option>
        <option value="MB">MB</option>
        <option value="GB">GB</option>
        <option value="TB">TB</option>
      </select>
    </div>
  );
}

function SensitiveInput(props: {
  fieldKey: string;
  value: string;
  meta: FieldMeta;
  onChange: (value: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState("");
  const originalPassword = useRef(props.value);
  const isPassword = props.meta.sensitive === "password";

  useEffect(() => {
    if (isPassword && /^\$2[aby]\$/.test(props.value)) {
      originalPassword.current = props.value;
      setPasswordDraft("");
    }
  }, [isPassword, props.value]);

  if (isPassword) {
    return (
      <div className="sensitive-field">
        <input
          type="password"
          value={passwordDraft}
          placeholder={props.value ? "已设置；留空表示保持不变" : "尚未设置"}
          autoComplete="new-password"
          onChange={(event) => {
            const next = event.target.value;
            setPasswordDraft(next);
            props.onChange(next || originalPassword.current);
          }}
        />
        <button
          type="button"
          className="ghost-button"
          onClick={() => {
            setPasswordDraft("");
            originalPassword.current = "";
            props.onChange("");
          }}
        >
          清除密码
        </button>
      </div>
    );
  }

  return (
    <div className="sensitive-field">
      <input
        type={revealed ? "text" : "password"}
        value={props.value}
        autoComplete="off"
        onChange={(event) => props.onChange(event.target.value)}
      />
      <button type="button" className="ghost-button" onClick={() => setRevealed((value) => !value)}>
        {revealed ? "隐藏" : "显示"}
      </button>
      {props.meta.sensitive === "apiKey" && (
        <>
          <button type="button" className="ghost-button" onClick={() => void navigator.clipboard.writeText(props.value)}>
            复制
          </button>
          <button type="button" className="ghost-button" onClick={() => props.onChange(generateAPIKey())}>
            重新生成
          </button>
        </>
      )}
    </div>
  );
}

function ConfigField(props: {
  group: AdvancedConfigGroup;
  fieldKey: string;
  value: unknown;
  path: ConfigPath;
  config: ConfigResponse;
  themes: string[];
  onChange: (config: ConfigResponse) => void;
}) {
  const meta = fieldMetaFor(props.group, props.fieldKey, props.value);
  const update = (value: unknown) => props.onChange(setConfigValue(props.config, props.path, value));
  const choices =
    props.group === "gui" && props.fieldKey === "theme" && props.themes.length > 0
      ? props.themes.map((theme) => ({ value: theme, label: theme }))
      : meta.choices;

  let control;
  if (meta.sensitive && typeof props.value === "string") {
    control = <SensitiveInput fieldKey={props.fieldKey} value={props.value} meta={meta} onChange={update} />;
  } else if (meta.kind === "boolean") {
    control = (
      <label className="advanced-boolean">
        <input type="checkbox" checked={Boolean(props.value)} onChange={(event) => update(event.target.checked)} />
        <span>{Boolean(props.value) ? "已启用" : "已禁用"}</span>
      </label>
    );
  } else if (meta.kind === "number" && typeof props.value === "number") {
    control = <NumberInput value={props.value} onChange={update} />;
  } else if (choices && typeof props.value === "string") {
    control = (
      <select value={props.value} onChange={(event) => update(event.target.value)}>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}（{choice.value}）
          </option>
        ))}
      </select>
    );
  } else if (meta.kind === "list" && Array.isArray(props.value)) {
    control = <ListInput value={props.value} onChange={update} />;
  } else if (meta.kind === "size" && props.value && typeof props.value === "object") {
    control = <SizeInput value={props.value as Record<string, unknown>} onChange={update} />;
  } else {
    control = <input value={typeof props.value === "string" ? props.value : ""} onChange={(event) => update(event.target.value)} />;
  }

  return (
    <div className="advanced-config-field">
      <FieldLabel meta={meta} fieldKey={props.fieldKey} />
      <div className="advanced-field-control">{control}</div>
    </div>
  );
}

function ConfigObjectFields(props: {
  group: AdvancedConfigGroup;
  object: Record<string, unknown>;
  path: ConfigPath;
  config: ConfigResponse;
  themes: string[];
  onChange: (config: ConfigResponse) => void;
}) {
  const entries = editableEntries(props.object);
  return (
    <div className="advanced-fields">
      {entries.map(([key, value]) => (
        <ConfigField
          key={key}
          group={props.group}
          fieldKey={key}
          value={value}
          path={[...props.path, key]}
          config={props.config}
          themes={props.themes}
          onChange={props.onChange}
        />
      ))}
    </div>
  );
}

function Section(props: { title: string; subtitle?: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="advanced-config-section" open={props.open}>
      <summary>
        <span>{props.title}</span>
        {props.subtitle && <small>{props.subtitle}</small>}
      </summary>
      <div className="advanced-section-body">{props.children}</div>
    </details>
  );
}

export default function AdvancedConfigModal(props: AdvancedConfigModalProps) {
  const errors = validateAdvancedConfig(props.config);
  const folders = useMemo(
    () =>
      props.config.folders
        .map((folder, index) => ({ folder, index }))
        .sort((left, right) => (left.folder.label || left.folder.id).localeCompare(right.folder.label || right.folder.id)),
    [props.config.folders],
  );
  const devices = useMemo(
    () =>
      props.config.devices
        .map((device, index) => ({ device, index }))
        .sort((left, right) => (left.device.name || left.device.deviceID).localeCompare(right.device.name || right.device.deviceID)),
    [props.config.devices],
  );

  return (
    <section className="advanced-config-editor">
      <div className="panel-header advanced-config-header">
        <div>
          <div className="eyebrow">完整配置</div>
          <h3>高级配置</h3>
          <p>这里直接编辑 Syncthing Core 的完整配置。错误设置可能导致无法连接、停止同步或损坏文件，请谨慎修改。</p>
        </div>
        <div className="panel-actions">
          <button type="button" className="ghost-button" onClick={props.onClose} disabled={props.busy}>
            关闭
          </button>
          <button type="button" className="primary-button" onClick={props.onSave} disabled={props.busy || errors.length > 0}>
            {props.busy ? "保存中..." : "保存高级配置"}
          </button>
        </div>
      </div>

      {props.message && <div className="inline-message info">{props.message}</div>}
      {props.restartRequired && <div className="inline-message warning">部分配置需要重启 Syncthing 才能生效。</div>}
      {errors.map((error) => (
        <div className="inline-message danger" key={error}>
          {error}
        </div>
      ))}

      <div className="advanced-config-sections">
        <Section title="性能优化" subtitle="集中调整扫描、磁盘、并发和连接参数" open>
          <PerformanceSettingsPanel config={props.config} onChange={props.onChange} />
        </Section>

        <Section title="GUI" subtitle="Web 管理界面、认证与安全" open>
          <ConfigObjectFields
            group="gui"
            object={props.config.gui}
            path={["gui"]}
            config={props.config}
            themes={props.themes}
            onChange={props.onChange}
          />
        </Section>

        <Section title="全局选项（Options）" subtitle="网络、发现、性能、升级和日志">
          <ConfigObjectFields
            group="options"
            object={props.config.options}
            path={["options"]}
            config={props.config}
            themes={props.themes}
            onChange={props.onChange}
          />
        </Section>

        <Section title="LDAP" subtitle="Web GUI 的目录服务认证">
          <ConfigObjectFields
            group="ldap"
            object={props.config.ldap}
            path={["ldap"]}
            config={props.config}
            themes={props.themes}
            onChange={props.onChange}
          />
        </Section>

        <Section title="文件夹" subtitle={`${folders.length} 个文件夹`}>
          <div className="advanced-nested-sections">
            {folders.map(({ folder, index }) => (
              <Section key={folder.id} title={folder.label || folder.id} subtitle={folder.id}>
                <ConfigObjectFields
                  group="folder"
                  object={folder}
                  path={["folders", index]}
                  config={props.config}
                  themes={props.themes}
                  onChange={props.onChange}
                />
              </Section>
            ))}
          </div>
        </Section>

        <Section title="设备" subtitle={`${devices.length} 个设备`}>
          <div className="advanced-nested-sections">
            {devices.map(({ device, index }) => (
              <Section key={device.deviceID} title={device.name || device.deviceID} subtitle={device.deviceID}>
                <ConfigObjectFields
                  group="device"
                  object={device}
                  path={["devices", index]}
                  config={props.config}
                  themes={props.themes}
                  onChange={props.onChange}
                />
              </Section>
            ))}
          </div>
        </Section>

        <Section title="默认值" subtitle="新建文件夹和设备时使用">
          <div className="advanced-nested-sections">
            <Section title="默认文件夹">
              <ConfigObjectFields
                group="folder"
                object={props.config.defaults.folder}
                path={["defaults", "folder"]}
                config={props.config}
                themes={props.themes}
                onChange={props.onChange}
              />
            </Section>
            <Section title="默认设备">
              <ConfigObjectFields
                group="device"
                object={props.config.defaults.device}
                path={["defaults", "device"]}
                config={props.config}
                themes={props.themes}
                onChange={props.onChange}
              />
            </Section>
            <Section title="默认忽略规则" subtitle="每行一条，保留空行">
              <div className="advanced-config-field">
                <FieldLabel
                  fieldKey="lines"
                  meta={{
                    label: "默认忽略规则",
                    description: "创建新文件夹时使用的默认忽略模式。每行一条规则，空行和顺序会原样保存。",
                    docsURL: "https://docs.syncthing.net/users/config#config-option-defaults.ignores.lines",
                    kind: "list",
                  }}
                />
                <ListInput
                  value={props.config.defaults.ignores.lines}
                  preserveEmpty
                  onChange={(value) => props.onChange(setConfigValue(props.config, ["defaults", "ignores", "lines"], value))}
                />
              </div>
            </Section>
          </div>
        </Section>
      </div>
    </section>
  );
}
