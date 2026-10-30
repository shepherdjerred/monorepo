package zfs

import (
	"reflect"
	"testing"

	apis "github.com/openebs/zfs-localpv/v2/pkg/apis/openebs.io/zfs/v1"
)

func TestRestoreIdleTimeoutPreservesReceiveArguments(t *testing.T) {
	restore := &apis.ZFSRestore{
		Spec: apis.ZFSRestoreSpec{VolumeName: "isolated-copy", RestoreSrc: "127.0.0.1:9010"},
		VolSpec: apis.VolumeInfo{
			PoolName: "pool", VolumeType: VolTypeDataset, Capacity: "1024",
			QuotaType: "refquota", RecordSize: "128k", ATime: "off",
			ThinProvision: "no", Dedup: "off", Compression: "lz4", LogBias: "latency",
		},
	}
	nc, recv, err := buildVolumeRestoreArgs(restore)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"-w", "300", "127.0.0.1", "9010"}; !reflect.DeepEqual(nc, want) {
		t.Fatalf("restore transport = %v, want %v", nc, want)
	}
	want := []string{"recv", "-o", "refquota=1024", "-o", "recordsize=128k", "-o", "atime=off", "-o", "reservation=1024", "-o", "mountpoint=legacy", "-o", "dedup=off", "-o", "compression=lz4", "-o", "logbias=latency", "-F", "pool/isolated-copy"}
	if !reflect.DeepEqual(recv, want) {
		t.Fatalf("receive arguments = %v, want %v", recv, want)
	}
}

func TestBackupIdleTimeoutPreservesSendArguments(t *testing.T) {
	backup := &apis.ZFSBackup{Spec: apis.ZFSBackupSpec{BackupDest: "127.0.0.1:9011", SnapName: "snapshot"}}
	volume := &apis.ZFSVolume{Spec: apis.VolumeInfo{PoolName: "pool"}}
	volume.Name = "original"
	for _, previous := range []string{"", "previous"} {
		backup.Spec.PrevSnapName = previous
		send, nc, err := buildVolumeBackupArgs(backup, volume)
		if err != nil {
			t.Fatal(err)
		}
		want := []string{"send", "pool/original@snapshot"}
		if previous != "" {
			want = []string{"send", "-i", "pool/original@previous", "pool/original@snapshot"}
		}
		if !reflect.DeepEqual(send, want) {
			t.Fatalf("send arguments = %v, want %v", send, want)
		}
		if want := []string{"-N", "-w", "300", "127.0.0.1", "9011"}; !reflect.DeepEqual(nc, want) {
			t.Fatalf("backup transport = %v, want %v", nc, want)
		}
	}
}

func TestBackupIdleTimeoutRejectsInvalidRemote(t *testing.T) {
	volume := &apis.ZFSVolume{Spec: apis.VolumeInfo{PoolName: "pool"}}
	for _, remote := range []string{"missing-port", "host:9011:extra"} {
		if _, _, err := buildVolumeBackupArgs(&apis.ZFSBackup{Spec: apis.ZFSBackupSpec{BackupDest: remote, SnapName: "snapshot"}}, volume); err == nil {
			t.Fatalf("accepted invalid backup endpoint %q", remote)
		}
	}
}

func TestRestoreTimeoutRejectsInvalidRemote(t *testing.T) {
	for _, remote := range []string{"missing-port", "host:9010:extra"} {
		if _, _, err := buildVolumeRestoreArgs(&apis.ZFSRestore{Spec: apis.ZFSRestoreSpec{RestoreSrc: remote}}); err == nil {
			t.Fatalf("accepted invalid restore endpoint %q", remote)
		}
	}
}
