package clouduploader

import (
	"context"
	"encoding/binary"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/sirupsen/logrus"
	"gocloud.dev/blob/memblob"
)

const (
	pv     = "pvc-1"
	daily  = "daily-backup"
	dailyN = "daily-backup-v2"
)

type gcFixture struct {
	t   *testing.T
	ctx context.Context
	c   *Conn
}

func newGCFixture(t *testing.T) *gcFixture {
	ctx := context.Background()
	bucket := memblob.OpenBucket(nil)
	t.Cleanup(func() { bucket.Close() })
	// The production VSL layout: zfspv-incr/backups/<backup>/torvalds/zfs/-<schedule>-<pv>-<backup>
	c := &Conn{ctx: ctx, bucket: bucket, Log: logrus.New(), prefix: "torvalds/zfs/", backupPathPrefix: "zfspv-incr"}
	return &gcFixture{t, ctx, c}
}

func backupName(schedule string, day int) string {
	return fmt.Sprintf("%s-202610%02d023000", schedule, day)
}

// write stores a stream and its .zfsvol; manifest also publishes .chain.json.
func (f *gcFixture) write(volume, schedule, backup string, to, from uint64, manifest bool) {
	f.t.Helper()
	data := make([]byte, 400)
	binary.LittleEndian.PutUint64(data[8:16], 0x2f5bacbac)
	binary.LittleEndian.PutUint64(data[40:48], to)
	binary.LittleEndian.PutUint64(data[48:56], from)
	key := f.c.GenerateRemoteFileWithSchd(volume, schedule, backup)
	if err := f.c.bucket.WriteAll(f.ctx, key+".zfsvol", []byte("{}"), nil); err != nil {
		f.t.Fatal(err)
	}
	if err := f.c.bucket.WriteAll(f.ctx, key, data, nil); err != nil {
		f.t.Fatal(err)
	}
	if manifest {
		if err := f.c.PublishZFSStream(volume, schedule, backup); err != nil {
			f.t.Fatal(err)
		}
	}
}

func (f *gcFixture) keys() []string {
	f.t.Helper()
	keys := []string{}
	iter := f.c.bucket.List(nil)
	for {
		obj, err := iter.Next(f.ctx)
		if err != nil {
			break
		}
		keys = append(keys, obj.Key)
	}
	sort.Strings(keys)
	return keys
}

// streamsOf returns the backups with a stream object for one family.
func (f *gcFixture) streamsOf(volume, schedule string, names ...string) []string {
	f.t.Helper()
	present := []string{}
	for _, name := range names {
		exists, err := f.c.bucket.Exists(f.ctx, f.c.GenerateRemoteFileWithSchd(volume, schedule, name))
		if err != nil {
			f.t.Fatal(err)
		}
		if exists {
			present = append(present, name)
		}
	}
	return present
}

func (f *gcFixture) sweep(volume, schedule, current string, retained ...string) (ZFSSweep, error) {
	set := map[string]bool{}
	for _, name := range retained {
		set[name] = true
	}
	return f.c.SweepZFSFamily(volume, schedule, current, set)
}

func names(schedule string, days ...int) []string {
	out := []string{}
	for _, day := range days {
		out = append(out, backupName(schedule, day))
	}
	return out
}

func TestSweepOutOfOrderExpiryDeletesWholeExpiredChain(t *testing.T) {
	f := newGCFixture(t)
	all := names(daily, 1, 2, 3, 4, 5)
	// Chain A: 1 <- 2 <- 3. Chain B: 4 <- 5.
	f.write(pv, daily, all[0], 1, 0, true)
	f.write(pv, daily, all[1], 2, 1, true)
	f.write(pv, daily, all[2], 3, 2, true)
	f.write(pv, daily, all[3], 4, 0, true)
	f.write(pv, daily, all[4], 5, 4, true)
	// The full expires first while its increments are still retained.
	got, err := f.sweep(pv, daily, all[0], all[1], all[2], all[3], all[4])
	if err != nil || len(got.Deleted) != 0 {
		t.Fatalf("full deleted under retained increments: %+v %v", got, err)
	}
	// The whole of chain A then expires together, in any order.
	got, err = f.sweep(pv, daily, all[2], all[3], all[4])
	if err != nil || !reflect.DeepEqual(got.Deleted, all[:3]) {
		t.Fatalf("deleted=%v err=%v", got.Deleted, err)
	}
	if left := f.streamsOf(pv, daily, all...); !reflect.DeepEqual(left, all[3:]) {
		t.Fatalf("remaining=%v", left)
	}
	for _, key := range f.keys() {
		for _, gone := range all[:3] {
			if strings.Contains(key, gone) {
				t.Fatalf("sibling %s survived", key)
			}
		}
	}
	chain, err := f.c.ZFSChain(pv, daily, all[4])
	if err != nil || !reflect.DeepEqual(chain, all[3:]) {
		t.Fatalf("surviving chain=%v err=%v", chain, err)
	}
}

func TestSweepProtectsAncestryOfRetainedIncremental(t *testing.T) {
	f := newGCFixture(t)
	all := names(daily, 1, 2, 3, 4)
	f.write(pv, daily, all[0], 10, 0, true)
	f.write(pv, daily, all[1], 11, 10, true)
	f.write(pv, daily, all[2], 12, 11, true)
	f.write(pv, daily, all[3], 20, 0, true) // unrelated, unretained full
	got, err := f.sweep(pv, daily, all[1], all[2])
	if err != nil || !reflect.DeepEqual(got.Deleted, all[3:]) || !reflect.DeepEqual(got.Protected, all[:3]) {
		t.Fatalf("sweep=%+v err=%v", got, err)
	}
	if chain, err := f.c.ZFSChain(pv, daily, all[2]); err != nil || len(chain) != 3 {
		t.Fatalf("retained restore broken: %v %v", chain, err)
	}
}

func TestSweepProtectsInFlightParent(t *testing.T) {
	f := newGCFixture(t)
	all := names(daily, 1, 2, 3)
	f.write(pv, daily, all[0], 1, 0, true)
	f.write(pv, daily, all[1], 2, 1, true)
	// The in-flight backup has only its .zfsvol; its ZFSBackup names all[1]
	// as prevSnapName, which the plugin adds to the retained set.
	key := f.c.GenerateRemoteFileWithSchd(pv, daily, all[2])
	if err := f.c.bucket.WriteAll(f.ctx, key+".zfsvol", []byte("{}"), nil); err != nil {
		t.Fatal(err)
	}
	got, err := f.sweep(pv, daily, all[1], all[1], all[2])
	if err != nil || len(got.Deleted) != 0 {
		t.Fatalf("in-flight parent removed: %+v %v", got, err)
	}
	if exists, _ := f.c.bucket.Exists(f.ctx, key+".zfsvol"); !exists {
		t.Fatal("in-flight .zfsvol removed")
	}
}

func TestSweepRetentionRecordsAloneProtectNewStreams(t *testing.T) {
	f := newGCFixture(t)
	all := names(daily, 1, 2, 3)
	f.write(pv, daily, all[0], 1, 0, true)
	f.write(pv, daily, all[1], 2, 0, true)
	// Just uploaded and still recorded (its Backup is in progress): its whole
	// ancestry stays, with no age-based hold anywhere in the decision.
	f.write(pv, daily, all[2], 3, 1, true)
	got, err := f.sweep(pv, daily, all[1], all[2])
	if err != nil || !reflect.DeepEqual(got.Deleted, all[1:2]) {
		t.Fatalf("sweep=%+v err=%v", got, err)
	}
	if left := f.streamsOf(pv, daily, all...); !reflect.DeepEqual(left, []string{all[0], all[2]}) {
		t.Fatalf("remaining=%v", left)
	}
	// Once nothing records it, a brand-new stream is reclaimable immediately.
	got, err = f.sweep(pv, daily, all[2])
	if err != nil || !reflect.DeepEqual(got.Deleted, []string{all[0], all[2]}) {
		t.Fatalf("unrecorded sweep=%+v err=%v", got, err)
	}
}

func TestSweepMissingParentFailsWithoutDeleting(t *testing.T) {
	f := newGCFixture(t)
	all := names(daily, 1, 2, 3)
	f.write(pv, daily, all[0], 1, 0, true)
	f.write(pv, daily, all[2], 3, 2, true) // parent GUID 2 is absent
	_, err := f.sweep(pv, daily, all[0], all[2])
	if err == nil || !strings.Contains(err.Error(), "missing parent") {
		t.Fatalf("err=%v", err)
	}
	if left := f.streamsOf(pv, daily, all...); !reflect.DeepEqual(left, []string{all[0], all[2]}) {
		t.Fatalf("deleted despite error: %v", left)
	}
}

func TestSweepCorruptHeaderFails(t *testing.T) {
	f := newGCFixture(t)
	all := names(daily, 1, 2)
	f.write(pv, daily, all[0], 1, 0, true)
	key := f.c.GenerateRemoteFileWithSchd(pv, daily, all[1])
	if err := f.c.bucket.WriteAll(f.ctx, key, []byte("truncated"), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := f.sweep(pv, daily, all[0]); err == nil {
		t.Fatal("swept a family with an unreadable stream")
	}
	if left := f.streamsOf(pv, daily, all...); len(left) != 2 {
		t.Fatalf("deleted despite error: %v", left)
	}
}

func TestSweepLegacyStreamsWithoutManifest(t *testing.T) {
	f := newGCFixture(t)
	all := names(daily, 1, 2, 3)
	f.write(pv, daily, all[0], 1, 0, false)
	f.write(pv, daily, all[1], 2, 1, false)
	f.write(pv, daily, all[2], 3, 0, false)
	got, err := f.sweep(pv, daily, all[2], all[1])
	if err != nil || !reflect.DeepEqual(got.Deleted, all[2:]) || !reflect.DeepEqual(got.Protected, all[:2]) {
		t.Fatalf("sweep=%+v err=%v", got, err)
	}
}

func TestSweepNeverTouchesPrefixSharingFamilies(t *testing.T) {
	f := newGCFixture(t)
	legacy := names(daily, 1, 2)
	v2 := names(dailyN, 1, 2)
	f.write(pv, daily, legacy[0], 1, 0, true)
	f.write(pv, daily, legacy[1], 2, 1, true)
	// The v2 schedule shares the legacy name as a prefix, and pvc-12 shares pvc-1.
	f.write(pv, dailyN, v2[0], 100, 0, true)
	f.write(pv, dailyN, v2[1], 101, 100, true)
	f.write("pvc-12", daily, legacy[0], 200, 0, true)
	f.write("pvc-12", daily, legacy[1], 201, 200, true)
	// A legacy-family stream without a Velero schedule name may be an ancestor
	// but is never identified as an expired scheduled backup.
	f.write(pv, daily, "daily-backup-seed", 3, 0, true)
	before := f.keys()
	got, err := f.sweep(pv, daily, legacy[1])
	if err != nil || !reflect.DeepEqual(got.Deleted, legacy) {
		t.Fatalf("sweep=%+v err=%v", got, err)
	}
	after := map[string]bool{}
	for _, key := range f.keys() {
		after[key] = true
	}
	for _, key := range before {
		owned := strings.Contains(key, "/-"+daily+"-"+pv+"-"+daily+"-2026")
		if after[key] == owned {
			t.Fatalf("key %s owned=%v present=%v", key, owned, after[key])
		}
	}
}

func TestScheduledBackupName(t *testing.T) {
	for name, want := range map[string]bool{
		"daily-backup-20261012023000":    true,
		"daily-backup-v2-20261012023000": false,
		"daily-backup-2026101202300":     false,
		"daily-backup-seed":              false,
		"daily-backup-20261399023000":    false,
		"20261012023000":                 false,
	} {
		if got := ScheduledBackupName(daily, name); got != want {
			t.Errorf("%s: got %v", name, got)
		}
	}
	if ScheduledBackupName("", "x-20261012023000") {
		t.Error("matched without a schedule")
	}
}

func TestSweepIsIdempotentAndResumesInterruptedDeletes(t *testing.T) {
	f := newGCFixture(t)
	all := names(daily, 1, 2, 3)
	f.write(pv, daily, all[0], 1, 0, true)
	f.write(pv, daily, all[1], 2, 1, true)
	f.write(pv, daily, all[2], 3, 0, true)
	// An earlier sweep removed all[0]'s siblings, then stopped.
	key := f.c.GenerateRemoteFileWithSchd(pv, daily, all[0])
	for _, sibling := range []string{key + ".chain.json", key + ".zfsvol"} {
		if err := f.c.bucket.Delete(f.ctx, sibling); err != nil {
			t.Fatal(err)
		}
	}
	got, err := f.sweep(pv, daily, all[1], all[2])
	if err != nil || !reflect.DeepEqual(got.Deleted, all[:2]) {
		t.Fatalf("first=%+v err=%v", got, err)
	}
	before := f.keys()
	got, err = f.sweep(pv, daily, all[1], all[2])
	if err != nil || len(got.Deleted) != 0 || !reflect.DeepEqual(before, f.keys()) {
		t.Fatalf("rerun=%+v err=%v", got, err)
	}
}

func TestSweepUnscheduledDeletesOnlyCurrent(t *testing.T) {
	f := newGCFixture(t)
	f.write(pv, "", "manual-a", 1, 0, true)
	f.write(pv, "", "manual-b", 2, 0, true)
	got, err := f.sweep(pv, "", "manual-a")
	if err != nil || !reflect.DeepEqual(got.Deleted, []string{"manual-a"}) {
		t.Fatalf("sweep=%+v err=%v", got, err)
	}
	if left := f.streamsOf(pv, "", "manual-a", "manual-b"); !reflect.DeepEqual(left, []string{"manual-b"}) {
		t.Fatalf("remaining=%v", left)
	}
	got, err = f.sweep(pv, "", "manual-b", "manual-b")
	if err != nil || len(got.Deleted) != 0 {
		t.Fatalf("retained unscheduled stream deleted: %+v %v", got, err)
	}
}

func TestPlanUnscheduledOwnsOnlyCurrent(t *testing.T) {
	streams := []ZFSStream{
		{Backup: "manual-a", ToGUID: "1", FromGUID: "0"},
		{Backup: "manual-b", ToGUID: "2", FromGUID: "0"},
	}
	_, deletions, err := PlanZFSSweep(streams, "", "manual-a", nil)
	if err != nil || !reflect.DeepEqual(deletions, []string{"manual-a"}) {
		t.Fatalf("deletions=%v err=%v", deletions, err)
	}
}

func TestListBackupNames(t *testing.T) {
	f := newGCFixture(t)
	for _, key := range []string{
		"torvalds/backups/backups/a/velero-backup.json",
		"torvalds/backups/backups/b/b-logs.gz",
		"torvalds/backups/restores/r/restore.json",
	} {
		if err := f.c.bucket.WriteAll(f.ctx, key, []byte("{}"), nil); err != nil {
			t.Fatal(err)
		}
	}
	got, err := f.c.ListBackupNames("torvalds/backups/")
	if err != nil || !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Fatalf("names=%v err=%v", got, err)
	}
}
