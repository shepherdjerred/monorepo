// SPDX-License-Identifier: Apache-2.0
package plugin

import (
	cloud "github.com/openebs/velero-plugin/pkg/clouduploader"
	"github.com/openebs/velero-plugin/pkg/velero"
	"github.com/openebs/velero-plugin/pkg/zfs/utils"
	apis "github.com/openebs/zfs-localpv/pkg/apis/openebs.io/zfs/v1"
	"github.com/openebs/zfs-localpv/pkg/builder/bkpbuilder"
	"github.com/pkg/errors"
	velerov1api "github.com/vmware-tanzu/velero/pkg/apis/velero/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Phases after which a Velero backup can no longer select a new parent.
var settledBackupPhases = map[velerov1api.BackupPhase]bool{
	velerov1api.BackupPhaseCompleted:        true,
	velerov1api.BackupPhasePartiallyFailed:  true,
	velerov1api.BackupPhaseFailed:           true,
	velerov1api.BackupPhaseFailedValidation: true,
	velerov1api.BackupPhaseDeleting:         true,
}

// retainedZFSBackups names every backup whose stream must stay restorable.
//
// It is the union of Velero backups that are not being deleted, backup
// metadata still in a storage location, and every ZFSBackup snapshot and
// parent. The backup being deleted is excluded only from the records its own
// deletion has not removed yet. It stays retained while a ZFSBackup names it
// as a parent, or while another backup of its schedule is unsettled and may
// have chosen it as a parent before its ZFSBackup was deleted. An unknown
// Velero phase counts as unsettled.
func retainedZFSBackups(current, schedule string, backups []velerov1api.Backup, metadata []string, zfsBackups []apis.ZFSBackup) map[string]bool {
	deleting := map[string]bool{current: true}
	retained := map[string]bool{}
	for _, backup := range backups {
		if backup.Status.Phase == velerov1api.BackupPhaseDeleting {
			deleting[backup.Name] = true
			continue
		}
		retained[backup.Name] = true
		if !settledBackupPhases[backup.Status.Phase] && schedule != "" &&
			backup.Labels[velerov1api.ScheduleNameLabel] == schedule {
			retained[current] = true
		}
	}
	for _, name := range metadata {
		if !deleting[name] {
			retained[name] = true
		}
	}
	for _, zfsBackup := range zfsBackups {
		if zfsBackup.Spec.SnapName != current {
			retained[zfsBackup.Spec.SnapName] = true
		}
		if zfsBackup.Spec.PrevSnapName != "" {
			retained[zfsBackup.Spec.PrevSnapName] = true
		}
	}
	delete(retained, "")
	return retained
}

// retainedBackups reads the live retention records. The current ZFSBackup is
// deleted first, so a backup that starts later cannot choose it as a parent.
func (p *Plugin) retainedBackups(current, schedule string) (map[string]bool, error) {
	backups, err := velero.ListBackups()
	if err != nil {
		return nil, err
	}
	locations, err := velero.ListBackupStorageLocations()
	if err != nil {
		return nil, err
	}
	metadata := []string{}
	for _, location := range locations {
		storage := location.Spec.ObjectStorage
		if storage == nil || storage.Bucket != p.config[cloud.BUCKET] ||
			location.Spec.Config[cloud.AWSUrl] != p.config[cloud.AWSUrl] {
			return nil, errors.Errorf("zfs: storage location %s is outside the snapshot bucket; its backups cannot be checked", location.Name)
		}
		names, err := p.cl.ListBackupNames(storage.Prefix)
		if err != nil {
			return nil, errors.Wrapf(err, "zfs: listing backups in storage location %s", location.Name)
		}
		metadata = append(metadata, names...)
	}
	zfsBackups, err := bkpbuilder.NewKubeclient().WithNamespace(p.namespace).List(metav1.ListOptions{})
	if err != nil {
		return nil, errors.Wrap(err, "zfs: listing ZFSBackups")
	}
	return retainedZFSBackups(current, schedule, backups, metadata, zfsBackups.Items), nil
}

// deleteSnapshot removes one backup's ZFSBackup, then sweeps its family's
// expired streams from object storage. Both steps are idempotent, and any
// failure is returned so Velero records the deletion as failed.
func (p *Plugin) deleteSnapshot(snapshotID string) error {
	pvname, schdname, snapname, err := utils.GetInfoFromSnapshotID(snapshotID)
	if err != nil {
		return err
	}
	bkpname := utils.GenerateResourceName(pvname, snapname)
	err = bkpbuilder.NewKubeclient().WithNamespace(p.namespace).Delete(bkpname)
	if err != nil && !k8serrors.IsNotFound(err) {
		return errors.Wrapf(err, "zfs: deleting ZFSBackup %s", bkpname)
	}
	retained, err := p.retainedBackups(snapname, schdname)
	if err != nil {
		return err
	}
	sweep, err := p.cl.SweepZFSFamily(pvname, schdname, snapname, retained)
	if err != nil {
		return errors.Wrapf(err, "zfs: sweeping schedule %q volume %s", schdname, pvname)
	}
	p.Log.Infof("zfs: swept schedule %q volume %s: deleted %v, protected %d", schdname, pvname, sweep.Deleted, len(sweep.Protected))
	return nil
}
