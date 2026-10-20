// SPDX-License-Identifier: Apache-2.0
package clouduploader

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"gocloud.dev/gcerrors"
)

// scheduleTimestamp is the suffix Velero appends to scheduled backup names.
const scheduleTimestamp = "20060102150405"

// ZFSSweep reports what one family sweep kept and removed.
type ZFSSweep struct {
	Protected []string
	Deleted   []string
}

// ScheduledBackupName reports whether Velero generated name for schedule:
// exactly "<schedule>-<yyyymmddhhmmss>". This rejects a longer schedule that
// shares the prefix, such as "daily-backup-v2-..." for "daily-backup".
func ScheduledBackupName(schedule, name string) bool {
	stamp := strings.TrimPrefix(name, schedule+"-")
	if schedule == "" || stamp == name || len(stamp) != len(scheduleTimestamp) {
		return false
	}
	_, err := time.Parse(scheduleTimestamp, stamp)
	return err == nil
}

// PlanZFSSweep selects the unprotected streams of one family.
//
// Retained backups are roots. Retention comes from live evidence, not object
// age: an upload in progress has a Velero Backup that is not being deleted and
// a ZFSBackup naming it, so it is retained until its own deletion. A root
// protects its whole GUID ancestry, and a root whose ancestry cannot be
// resolved fails the plan rather than exposing its remaining ancestors.
// Only streams whose names positively identify them as this schedule's
// backups (or, without a schedule, the current backup) are ever deleted.
func PlanZFSSweep(streams []ZFSStream, schedule, current string, retained map[string]bool) (map[string]bool, []string, error) {
	protected := map[string]bool{}
	for _, stream := range streams {
		if !retained[stream.Backup] {
			continue
		}
		chain, err := ResolveZFSChain(streams, stream.Backup)
		if err != nil {
			return nil, nil, fmt.Errorf("protecting %s: %w", stream.Backup, err)
		}
		for _, name := range chain {
			protected[name] = true
		}
	}
	deletions := []string{}
	for _, stream := range streams {
		if protected[stream.Backup] {
			continue
		}
		owned := ScheduledBackupName(schedule, stream.Backup)
		if schedule == "" {
			owned = stream.Backup == current
		}
		if owned {
			deletions = append(deletions, stream.Backup)
		}
	}
	sort.Strings(deletions)
	return protected, deletions, nil
}

// readFamilyStream returns the completed stream at the exact family key.
func (c *Conn) readFamilyStream(volume, schedule, backup string) (ZFSStream, bool, error) {
	key := c.GenerateRemoteFileWithSchd(volume, schedule, backup)
	exists, err := c.bucket.Exists(c.ctx, key)
	if err != nil || !exists {
		return ZFSStream{}, false, err
	}
	stream, err := c.ReadZFSStream(volume, schedule, backup)
	if err != nil {
		return ZFSStream{}, false, err
	}
	return stream, true, nil
}

// ZFSFamily lists the completed streams of one schedule+volume family: the
// same universe ZFSChain resolves restores from. Every candidate is confirmed
// at its exact key, so a listing match on a shared prefix is never a member.
func (c *Conn) ZFSFamily(volume, schedule, current string, retained map[string]bool) ([]ZFSStream, error) {
	names := []string{current}
	if schedule != "" {
		var err error
		names, err = c.GetSnapListFromCloud(c.GetFileNameWithSchd(volume, schedule), schedule)
		if err != nil {
			return nil, err
		}
	}
	listed := map[string]bool{}
	streams := []ZFSStream{}
	for _, name := range names {
		if listed[name] {
			continue
		}
		listed[name] = true
		stream, ok, err := c.readFamilyStream(volume, schedule, name)
		if err != nil {
			return nil, err
		}
		if ok { // A .zfsvol alone is an incomplete or in-flight upload.
			streams = append(streams, stream)
		}
	}
	// A retained stream the listing should have returned but did not would
	// leave its ancestors unprotected, so treat that listing as unusable.
	for name := range retained {
		if listed[name] || schedule == "" || !strings.HasPrefix(name, schedule) {
			continue
		}
		if _, ok, err := c.readFamilyStream(volume, schedule, name); err != nil {
			return nil, err
		} else if ok {
			return nil, fmt.Errorf("listing omitted retained ZFS stream %s", name)
		}
	}
	return streams, nil
}

// SweepZFSFamily deletes every unprotected stream of one schedule+volume
// family with its .zfsvol and .chain.json siblings. It converges whatever
// order Velero expires backups in, and a repeated run is a no-op.
func (c *Conn) SweepZFSFamily(volume, schedule, current string, retained map[string]bool) (ZFSSweep, error) {
	sweep := ZFSSweep{}
	streams, err := c.ZFSFamily(volume, schedule, current, retained)
	if err != nil {
		return sweep, err
	}
	protected, deletions, err := PlanZFSSweep(streams, schedule, current, retained)
	if err != nil {
		return sweep, err
	}
	for name := range protected {
		sweep.Protected = append(sweep.Protected, name)
	}
	sort.Strings(sweep.Protected)
	for _, name := range deletions {
		key := c.GenerateRemoteFileWithSchd(volume, schedule, name)
		// The stream goes last, so an interrupted sweep is rediscovered.
		for _, object := range []string{key + ".chain.json", key + ".zfsvol", key} {
			if err := c.bucket.Delete(c.ctx, object); err != nil && gcerrors.Code(err) != gcerrors.NotFound {
				return sweep, fmt.Errorf("deleting %s: %w", object, err)
			}
		}
		c.Log.Infof("zfs: removed expired stream %s", key)
		sweep.Deleted = append(sweep.Deleted, name)
	}
	return sweep, nil
}

// ListBackupNames lists the backup directories of a Velero storage location.
func (c *Conn) ListBackupNames(storagePrefix string) ([]string, error) {
	base := strings.Trim(storagePrefix, "/")
	if base != "" {
		base += "/"
	}
	base += backupDir + "/"
	dirs, err := c.listKeys(base, ListKeyDir)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(dirs))
	for _, dir := range dirs {
		name := strings.TrimSuffix(strings.TrimPrefix(dir, base), "/")
		if name == "" || strings.Contains(name, "/") {
			return nil, fmt.Errorf("unexpected Velero metadata key %s", dir)
		}
		names = append(names, name)
	}
	return names, nil
}
