// SPDX-License-Identifier: Apache-2.0
package clouduploader

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
)

// ZFSStream is a durable description of an actual offsite send stream.
// GUID strings preserve all 64 bits in cross-language JSON consumers.
type ZFSStream struct {
	Version  int    `json:"version"`
	Volume   string `json:"volume"`
	Backup   string `json:"backup"`
	Key      string `json:"key"`
	Bytes    int64  `json:"bytes"`
	ToGUID   string `json:"toGuid"`
	FromGUID string `json:"fromGuid"`
}

func ParseZFSHeader(data []byte) (string, string, error) {
	if len(data) != 312 {
		return "", "", fmt.Errorf("incomplete DRR_BEGIN record")
	}
	var order binary.ByteOrder = binary.LittleEndian
	if order.Uint64(data[8:16]) != 0x2f5bacbac {
		order = binary.BigEndian
		if order.Uint64(data[8:16]) != 0x2f5bacbac {
			return "", "", fmt.Errorf("invalid ZFS stream magic")
		}
	}
	if order.Uint32(data[:4]) != 0 || order.Uint64(data[40:48]) == 0 {
		return "", "", fmt.Errorf("invalid DRR_BEGIN record")
	}
	return fmt.Sprint(order.Uint64(data[40:48])), fmt.Sprint(order.Uint64(data[48:56])), nil
}

func (c *Conn) ReadZFSStream(volume, schedule, backup string) (ZFSStream, error) {
	key := c.GenerateRemoteFileWithSchd(volume, schedule, backup)
	var stream ZFSStream
	reader, err := c.bucket.NewRangeReader(c.ctx, key, 0, 312, nil)
	if err != nil {
		return stream, err
	}
	defer reader.Close()
	data := make([]byte, 312)
	if _, err := io.ReadFull(reader, data); err != nil {
		return stream, err
	}
	to, from, err := ParseZFSHeader(data)
	if err != nil {
		return stream, fmt.Errorf("%s: %w", key, err)
	}
	attrs, err := c.bucket.Attributes(c.ctx, key)
	if err != nil {
		return stream, err
	}
	return ZFSStream{1, volume, backup, key, attrs.Size, to, from}, nil
}

func (c *Conn) PublishZFSStream(volume, schedule, backup string) error {
	stream, err := c.ReadZFSStream(volume, schedule, backup)
	if err != nil {
		return err
	}
	data, err := json.Marshal(stream)
	if err != nil {
		return err
	}
	if !c.Write(data, stream.Key+".chain.json") {
		return fmt.Errorf("failed to publish ZFS chain metadata")
	}
	return nil
}

// ResolveZFSChain follows stream GUIDs rather than positions in a pruned list.
func ResolveZFSChain(streams []ZFSStream, target string) ([]string, error) {
	byGUID := map[string]ZFSStream{}
	var root *ZFSStream
	for i := range streams {
		stream := streams[i]
		if _, exists := byGUID[stream.ToGUID]; exists {
			return nil, fmt.Errorf("ambiguous ZFS GUID %s", stream.ToGUID)
		}
		byGUID[stream.ToGUID] = stream
		if stream.Backup == target {
			root = &streams[i]
		}
	}
	if root == nil {
		return nil, fmt.Errorf("ZFS stream %s missing", target)
	}
	chain := []string{}
	seen := map[string]bool{}
	current := *root
	for {
		if seen[current.ToGUID] {
			return nil, fmt.Errorf("cyclic ZFS chain at %s", current.Backup)
		}
		seen[current.ToGUID] = true
		chain = append(chain, current.Backup)
		if current.FromGUID == "0" {
			break
		}
		parent, exists := byGUID[current.FromGUID]
		if !exists {
			return nil, fmt.Errorf("ZFS chain %s missing parent GUID %s", target, current.FromGUID)
		}
		current = parent
	}
	for left, right := 0, len(chain)-1; left < right; left, right = left+1, right-1 {
		chain[left], chain[right] = chain[right], chain[left]
	}
	return chain, nil
}

func (c *Conn) ZFSChain(volume, schedule, target string) ([]string, error) {
	names := []string{target}
	if schedule != "" {
		var err error
		names, err = c.GetSnapListFromCloud(c.GetFileNameWithSchd(volume, schedule), schedule)
		if err != nil {
			return nil, err
		}
	}
	streams := []ZFSStream{}
	for _, name := range names {
		key := c.GenerateRemoteFileWithSchd(volume, schedule, name)
		exists, err := c.bucket.Exists(c.ctx, key)
		if err != nil {
			return nil, err
		}
		if !exists {
			continue
		} // A .zfsvol alone is not a completed stream.
		stream, err := c.ReadZFSStream(volume, schedule, name)
		if err != nil {
			return nil, err
		}
		streams = append(streams, stream)
	}
	return ResolveZFSChain(streams, target)
}

// PreviousZFSStream rotates by actual ancestry depth, independent of CR TTL.
func (c *Conn) PreviousZFSStream(volume, schedule, target string, incremental uint64) (string, error) {
	chain, err := c.ZFSChain(volume, schedule, target)
	if err != nil {
		return "", err
	}
	if uint64(len(chain)) > incremental {
		return "", nil
	}
	return target, nil
}
