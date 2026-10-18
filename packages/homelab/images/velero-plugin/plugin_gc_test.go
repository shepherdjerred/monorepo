package plugin

import (
	"reflect"
	"sort"
	"testing"

	apis "github.com/openebs/zfs-localpv/pkg/apis/openebs.io/zfs/v1"
	velerov1api "github.com/vmware-tanzu/velero/pkg/apis/velero/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const (
	schedule = "daily-backup-v2"
	current  = "daily-backup-v2-20261001023000"
)

func veleroBackup(name, schedule string, phase velerov1api.BackupPhase) velerov1api.Backup {
	backup := velerov1api.Backup{ObjectMeta: metav1.ObjectMeta{Name: name}}
	if schedule != "" {
		backup.Labels = map[string]string{velerov1api.ScheduleNameLabel: schedule}
	}
	backup.Status.Phase = phase
	return backup
}

func zfsBackup(snap, prev string) apis.ZFSBackup {
	backup := apis.ZFSBackup{}
	backup.Spec.SnapName = snap
	backup.Spec.PrevSnapName = prev
	return backup
}

func sorted(set map[string]bool) []string {
	out := []string{}
	for name := range set {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func TestRetainedExcludesOnlyBackupsBeingDeleted(t *testing.T) {
	backups := []velerov1api.Backup{
		veleroBackup(current, schedule, velerov1api.BackupPhaseDeleting),
		veleroBackup("other-deleting", schedule, velerov1api.BackupPhaseDeleting),
		veleroBackup("completed", schedule, velerov1api.BackupPhaseCompleted),
		veleroBackup("failed", schedule, velerov1api.BackupPhaseFailed),
		veleroBackup("partial", "", velerov1api.BackupPhasePartiallyFailed),
	}
	// Velero removes metadata after DeleteSnapshot, so the current backup and
	// others still being deleted can appear in storage.
	metadata := []string{current, "other-deleting", "unsynced"}
	zfsBackups := []apis.ZFSBackup{
		zfsBackup(current, "completed"), // another volume's record of this backup
		zfsBackup("other-deleting", ""),
	}
	got := sorted(retainedZFSBackups(current, schedule, backups, metadata, zfsBackups))
	want := []string{"completed", "failed", "other-deleting", "partial", "unsynced"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("retained=%v want %v", got, want)
	}
}

func TestRetainedKeepsCurrentWhileNamedAsParent(t *testing.T) {
	zfsBackups := []apis.ZFSBackup{zfsBackup("daily-backup-v2-20261002023000", current)}
	if !retainedZFSBackups(current, schedule, nil, nil, zfsBackups)[current] {
		t.Fatal("in-flight prevSnapName not retained")
	}
}

func TestRetainedKeepsCurrentWhileItsScheduleIsUnsettled(t *testing.T) {
	for phase, want := range map[velerov1api.BackupPhase]bool{
		velerov1api.BackupPhaseNew:             true,
		velerov1api.BackupPhaseInProgress:      true,
		"WaitingForPluginOperations":           true,
		"Finalizing":                           true,
		"":                                     true,
		velerov1api.BackupPhaseCompleted:       false,
		velerov1api.BackupPhaseFailed:          false,
		velerov1api.BackupPhaseDeleting:        false,
		velerov1api.BackupPhasePartiallyFailed: false,
	} {
		backups := []velerov1api.Backup{veleroBackup("daily-backup-v2-20261002023000", schedule, phase)}
		if got := retainedZFSBackups(current, schedule, backups, nil, nil)[current]; got != want {
			t.Errorf("phase %q: current retained=%v", phase, got)
		}
	}
	other := []velerov1api.Backup{veleroBackup("weekly-backup-v2-20261002023000", "weekly-backup-v2", velerov1api.BackupPhaseInProgress)}
	if retainedZFSBackups(current, schedule, other, nil, nil)[current] {
		t.Error("another schedule's backup retained the current backup")
	}
}

func TestRetainedKeepsCurrentWhileVeleroStillHasIt(t *testing.T) {
	backups := []velerov1api.Backup{veleroBackup(current, schedule, velerov1api.BackupPhaseCompleted)}
	if !retainedZFSBackups(current, schedule, backups, nil, nil)[current] {
		t.Fatal("a backup Velero is not deleting lost its stream")
	}
}
