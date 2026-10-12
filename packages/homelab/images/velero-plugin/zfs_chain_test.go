package clouduploader

import (
	"context"
	"encoding/binary"
	"fmt"
	"github.com/sirupsen/logrus"
	"gocloud.dev/blob/memblob"
	"reflect"
	"testing"
)

func TestCloudLineageRotationAndPublication(t *testing.T) {
	ctx := context.Background()
	bucket := memblob.OpenBucket(nil)
	defer bucket.Close()
	c := &Conn{ctx: ctx, bucket: bucket, Log: logrus.New(), prefix: "node/zfs/", backupPathPrefix: "zfspv-incr"}
	write := func(name string, to, from uint64) {
		t.Helper()
		data := make([]byte, 312)
		binary.LittleEndian.PutUint64(data[8:16], 0x2f5bacbac)
		binary.LittleEndian.PutUint64(data[40:48], to)
		binary.LittleEndian.PutUint64(data[48:56], from)
		key := c.GenerateRemoteFileWithSchd("pvc-volume", "six-hourly-v2", name)
		if err := bucket.WriteAll(ctx, key, data, nil); err != nil {
			t.Fatal(err)
		}
		if err := c.PublishZFSStream("pvc-volume", "six-hourly-v2", name); err != nil {
			t.Fatal(err)
		}
		if exists, err := bucket.Exists(ctx, key+".chain.json"); err != nil || !exists {
			t.Fatalf("manifest exists=%v err=%v", exists, err)
		}
	}
	// A full plus eleven increments must rotate even if live CRs expired.
	for i := 1; i <= 12; i++ {
		write(fmt.Sprintf("six-hourly-v2-%03d", i), uint64(i), uint64(i-1))
	}
	base, err := c.PreviousZFSStream("pvc-volume", "six-hourly-v2", "six-hourly-v2-012", 11)
	if err != nil || base != "" {
		t.Fatalf("rotation base=%s err=%v", base, err)
	}
	write("six-hourly-v2-013", 13, 0)
	write("six-hourly-v2-014", 14, 13)
	// Removing an expired historical full cannot shift the current chain.
	if err := bucket.Delete(ctx, c.GenerateRemoteFileWithSchd("pvc-volume", "six-hourly-v2", "six-hourly-v2-001")); err != nil {
		t.Fatal(err)
	}
	chain, err := c.ZFSChain("pvc-volume", "six-hourly-v2", "six-hourly-v2-014")
	if err != nil || !reflect.DeepEqual(chain, []string{"six-hourly-v2-013", "six-hourly-v2-014"}) {
		t.Fatalf("chain=%v err=%v", chain, err)
	}
	if _, err := c.ZFSChain("pvc-volume", "six-hourly-v2", "six-hourly-v2-012"); err == nil {
		t.Fatal("accepted expired ancestor")
	}
}

func TestZFSChain(t *testing.T) {
	streams := []ZFSStream{{Backup: "expired-full", ToGUID: "1", FromGUID: "0"}, {Backup: "retained", ToGUID: "2", FromGUID: "1"}, {Backup: "unrelated-full", ToGUID: "3", FromGUID: "0"}}
	chain, err := ResolveZFSChain(streams, "retained")
	if err != nil || !reflect.DeepEqual(chain, []string{"expired-full", "retained"}) {
		t.Fatalf("chain=%v err=%v", chain, err)
	}
	for _, invalid := range [][]ZFSStream{streams[1:], {streams[0], streams[0]}, {{Backup: "cycle", ToGUID: "1", FromGUID: "1"}}} {
		target := "retained"
		if len(invalid) == 1 {
			target = "cycle"
		}
		if _, err := ResolveZFSChain(invalid, target); err == nil {
			t.Fatal("accepted incomplete, ambiguous or cyclic chain")
		}
	}
}
func TestZFSHeader(t *testing.T) {
	for _, order := range []binary.ByteOrder{binary.LittleEndian, binary.BigEndian} {
		data := make([]byte, 312)
		order.PutUint64(data[8:16], 0x2f5bacbac)
		order.PutUint64(data[40:48], ^uint64(0))
		to, from, err := ParseZFSHeader(data)
		if err != nil || to != "18446744073709551615" || from != "0" {
			t.Fatalf("header=%s/%s err=%v", to, from, err)
		}
	}
	if _, _, err := ParseZFSHeader(make([]byte, 312)); err == nil {
		t.Fatal("accepted invalid magic")
	}
}
