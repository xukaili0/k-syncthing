package model

import (
	"testing"
	"time"

	"github.com/syncthing/syncthing/lib/protocol"
)

func TestBuildCompareEntriesStatuses(t *testing.T) {
	local := map[string]protocol.FileInfo{
		"same.txt":     testCompareFile("same.txt", 10, 100, []byte("same")),
		"modified.txt": testCompareFile("modified.txt", 10, 100, []byte("local")),
		"only-local":   testCompareFile("only-local", 10, 100, []byte("local-only")),
	}
	remote := map[string]protocol.FileInfo{
		"same.txt":     testCompareFile("same.txt", 10, 100, []byte("same")),
		"modified.txt": testCompareFile("modified.txt", 10, 100, []byte("remote")),
		"only-remote":  testCompareFile("only-remote", 12, 100, []byte("remote-only")),
	}

	entries := buildCompareEntries(local, remote, 0, false)
	got := map[string]string{}
	for _, entry := range entries {
		got[entry.Path] = entry.Status
	}

	if got["same.txt"] != "same" {
		t.Fatalf("expected same.txt to be same, got %q", got["same.txt"])
	}
	if got["modified.txt"] != "modified" {
		t.Fatalf("expected modified.txt to be modified, got %q", got["modified.txt"])
	}
	if got["only-local"] != "only-local" {
		t.Fatalf("expected only-local to be only-local, got %q", got["only-local"])
	}
	if got["only-remote"] != "only-remote" {
		t.Fatalf("expected only-remote to be only-remote, got %q", got["only-remote"])
	}
}

func TestBuildCompareEntriesRenameCandidates(t *testing.T) {
	hash := []byte("shared-hash")
	local := map[string]protocol.FileInfo{
		"old/name.txt": testCompareFile("old/name.txt", 10, 100, hash),
	}
	remote := map[string]protocol.FileInfo{
		"new/name.txt": testCompareFile("new/name.txt", 10, 100, hash),
	}

	entries := buildCompareEntries(local, remote, 0, false)
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}

	renameTargets := map[string]string{}
	for _, entry := range entries {
		renameTargets[entry.Path] = entry.RenameCandidate
	}

	if renameTargets["old/name.txt"] != "new/name.txt" {
		t.Fatalf("expected local rename candidate, got %q", renameTargets["old/name.txt"])
	}
	if renameTargets["new/name.txt"] != "old/name.txt" {
		t.Fatalf("expected remote rename candidate, got %q", renameTargets["new/name.txt"])
	}
}

func TestBuildCompareEntriesRenameCandidatesAcrossDeleteTombstones(t *testing.T) {
	hash := []byte("shared-hash")
	localFile := testCompareFile("MinerU-0.12.0-setup.exe", 429, 100, hash)
	remoteMoved := testCompareFile("exe/MinerU-0.12.0-setup.exe", 429, 101, hash)

	localDeleted := testCompareDeletedFile("exe/MinerU-0.12.0-setup.exe", 102)
	remoteDeleted := testCompareDeletedFile("MinerU-0.12.0-setup.exe", 103)

	local := map[string]protocol.FileInfo{
		"MinerU-0.12.0-setup.exe":     localFile,
		"exe/MinerU-0.12.0-setup.exe": localDeleted,
	}
	remote := map[string]protocol.FileInfo{
		"MinerU-0.12.0-setup.exe":     remoteDeleted,
		"exe/MinerU-0.12.0-setup.exe": remoteMoved,
	}

	entries := buildCompareEntries(local, remote, 0, false)
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}

	renameTargets := map[string]string{}
	statuses := map[string]string{}
	for _, entry := range entries {
		renameTargets[entry.Path] = entry.RenameCandidate
		statuses[entry.Path] = entry.Status
	}

	if statuses["MinerU-0.12.0-setup.exe"] != "deleted-remote" {
		t.Fatalf("expected old path to be deleted-remote, got %q", statuses["MinerU-0.12.0-setup.exe"])
	}
	if statuses["exe/MinerU-0.12.0-setup.exe"] != "deleted-local" {
		t.Fatalf("expected new path to be deleted-local, got %q", statuses["exe/MinerU-0.12.0-setup.exe"])
	}
	if renameTargets["MinerU-0.12.0-setup.exe"] != "exe/MinerU-0.12.0-setup.exe" {
		t.Fatalf("expected old path rename candidate, got %q", renameTargets["MinerU-0.12.0-setup.exe"])
	}
	if renameTargets["exe/MinerU-0.12.0-setup.exe"] != "MinerU-0.12.0-setup.exe" {
		t.Fatalf("expected new path rename candidate, got %q", renameTargets["exe/MinerU-0.12.0-setup.exe"])
	}
	if entries[0].Path != "MinerU-0.12.0-setup.exe" || entries[1].Path != "exe/MinerU-0.12.0-setup.exe" {
		t.Fatalf("expected rename pair to stay grouped in display order, got %q then %q", entries[0].Path, entries[1].Path)
	}
}

func TestFilterCompareEntries(t *testing.T) {
	lfTmp := testCompareFile("x", 1, 1, []byte("x"))
	lf := &lfTmp
	entries := []CompareEntry{
		{Path: "same.txt", Status: "same", Local: lf, Remote: lf},
		{Path: "modified.txt", Status: "modified", Local: lf, Remote: lf},
		{Path: "deleted.txt", Status: "deleted-remote", Local: lf, Remote: lf},
		{Path: "rename.txt", Status: "only-remote", Remote: lf, RenameCandidate: "old.txt"},
	}

	if got := len(filterCompareEntries(entries, CompareViewDifferent)); got != 3 {
		t.Fatalf("expected 3 different entries, got %d", got)
	}
	if got := len(filterCompareEntries(entries, CompareViewDelete)); got != 1 {
		t.Fatalf("expected 1 delete entry, got %d", got)
	}
	if got := len(filterCompareEntries(entries, CompareViewRename)); got != 1 {
		t.Fatalf("expected 1 rename entry, got %d", got)
	}
}

func TestBuildCompareEntriesDoesNotTreatManualPolicyFlagsAsConflict(t *testing.T) {
	localDeleted := testCompareDeletedFile("file.zip", 200)
	localDeleted.LocalFlags = protocol.FlagLocalReceiveOnly

	remoteFile := testCompareFile("file.zip", 96, 100, []byte("remote"))

	entries := buildCompareEntries(
		map[string]protocol.FileInfo{"file.zip": localDeleted},
		map[string]protocol.FileInfo{"file.zip": remoteFile},
		0, false,
	)
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Status != "deleted-local" {
		t.Fatalf("expected deleted-local instead of conflict, got %q", entries[0].Status)
	}
}

func testCompareFile(name string, size int64, modifiedS int64, hash []byte) protocol.FileInfo {
	return protocol.FileInfo{
		Name:       name,
		Type:       protocol.FileInfoTypeFile,
		Size:       size,
		ModifiedS:  modifiedS,
		BlocksHash: hash,
		Blocks: []protocol.BlockInfo{{
			Hash:   hash,
			Offset: 0,
			Size:   int(size),
		}},
		RawBlockSize: 128 << 10,
		ModifiedNs:   int32(time.Second),
	}
}

func testCompareDeletedFile(name string, modifiedS int64) protocol.FileInfo {
	return protocol.FileInfo{
		Name:       name,
		Type:       protocol.FileInfoTypeFile,
		Deleted:    true,
		ModifiedS:  modifiedS,
		ModifiedNs: int32(time.Second),
	}
}
