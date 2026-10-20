// SPDX-License-Identifier: Apache-2.0
package velero

import (
	"context"

	"github.com/pkg/errors"
	velerov1api "github.com/vmware-tanzu/velero/pkg/apis/velero/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func requireClient() error {
	if clientSet == nil || veleroNs == "" {
		return errors.New("velero clientset or VELERO_NAMESPACE is not initialized")
	}
	return nil
}

// ListBackups returns every Velero Backup in the installation namespace.
func ListBackups() ([]velerov1api.Backup, error) {
	if err := requireClient(); err != nil {
		return nil, err
	}
	list, err := clientSet.VeleroV1().Backups(veleroNs).List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list velero backups")
	}
	return list.Items, nil
}

// ListBackupStorageLocations returns every BackupStorageLocation.
func ListBackupStorageLocations() ([]velerov1api.BackupStorageLocation, error) {
	if err := requireClient(); err != nil {
		return nil, err
	}
	list, err := clientSet.VeleroV1().BackupStorageLocations(veleroNs).List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list backup storage locations")
	}
	return list.Items, nil
}
