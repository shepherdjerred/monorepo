package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/xeipuuv/gojsonschema"
)

//go:embed protocol.schema.json
var protocolSchema []byte

type Plan struct {
	Kind                    string            `json:"kind"`
	SchemaVersion           int               `json:"schemaVersion"`
	Source                  string            `json:"source"`
	Branch                  string            `json:"branch"`
	RequestID               string            `json:"requestId"`
	YAMLSHA256              string            `json:"yamlSha256"`
	PermissionImage         string            `json:"permissionImage"`
	JobImagePullSecrets     []string          `json:"jobImagePullSecrets"`
	Steps                   []PlannedStep     `json:"steps"`
	ComponentAcceptanceOnly bool              `json:"componentAcceptanceOnly"`
	Policy                  map[string]string `json:"policy"`
}
type PlannedStep struct {
	Name      string                       `json:"name"`
	UUID      string                       `json:"uuid"`
	Image     string                       `json:"image"`
	Commands  []string                     `json:"commands"`
	Volumes   []string                     `json:"volumes"`
	Resources map[string]map[string]string `json:"resources"`
}
type Record struct {
	Kind          string `json:"kind"`
	SchemaVersion int    `json:"schemaVersion"`
	RequestID     string `json:"requestId"`
	PlanSHA256    string `json:"planSha256"`
	Resource      string `json:"resource"`
	Name          string `json:"name"`
	UID           string `json:"uid"`
	State         string `json:"state"`
}

func digest(b []byte) string { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }
func decode(b []byte, into any) error {
	result, err := gojsonschema.Validate(gojsonschema.NewBytesLoader(protocolSchema), gojsonschema.NewBytesLoader(b))
	if err != nil {
		return err
	}
	if !result.Valid() {
		return fmt.Errorf("invalid PMS protocol: %v", result.Errors())
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err := d.Decode(into); err != nil {
		return err
	}
	if err := d.Decode(new(any)); !errors.Is(err, io.EOF) {
		return errors.New("trailing protocol data")
	}
	return nil
}
func loadPlan(path, yamlPath string) (Plan, []byte, string, error) {
	var p Plan
	b, err := os.ReadFile(path)
	if err != nil {
		return p, nil, "", err
	}
	if len(b) > 1<<20 {
		return p, nil, "", errors.New("oversized plan")
	}
	if err = decode(b, &p); err != nil {
		return p, nil, "", err
	}
	y, err := os.ReadFile(yamlPath)
	if err != nil {
		return p, nil, "", err
	}
	if len(y) > 1<<20 || digest(y) != p.YAMLSHA256 {
		return p, nil, "", errors.New("YAML digest mismatch")
	}
	for i, name := range []string{"clone", "media-pms-wire", "media-pms-native"} {
		if p.Steps[i].Name != name || p.Steps[i].UUID != fmt.Sprintf("%s-%d", p.RequestID, i) {
			return p, nil, "", errors.New("step identity/order mismatch")
		}
	}
	return p, y, digest(b), nil
}
func (p Plan) resources(hash string) []Record {
	makeRecord := func(resource, name string) Record {
		return Record{"pms-resource", 1, p.RequestID, hash, resource, name, "", "intent"}
	}
	result := []Record{}
	for _, step := range p.Steps {
		result = append(result, makeRecord("pods", "wp-"+step.UUID))
	}
	result = append(result, makeRecord("services", "wp-hsvc-"+p.RequestID), makeRecord("persistentvolumeclaims", "pms-"+p.RequestID+"-default"))
	return result
}
func (p Plan) caches() []string {
	var result []string
	for _, step := range p.Steps {
		for _, volume := range step.Volumes {
			result = append(result, strings.Split(volume, ":")[0])
		}
	}
	slices.Sort(result)
	return slices.Compact(result)
}

type Ledger struct {
	file    *os.File
	records map[string]Record
}

func key(r Record) string { return r.Resource + "/" + r.Name }
func openLedger(path string, resume bool) (*Ledger, error) {
	flags := os.O_RDWR | os.O_APPEND
	if !resume {
		flags |= os.O_CREATE | os.O_EXCL
	}
	f, err := os.OpenFile(path, flags, 0o600)
	if err != nil {
		return nil, err
	}
	l := &Ledger{f, map[string]Record{}}
	if resume {
		s := bufio.NewScanner(f)
		s.Buffer(make([]byte, 4096), 1<<20)
		for s.Scan() {
			var r Record
			if err = decode(s.Bytes(), &r); err != nil {
				break
			}
			if err = l.transition(r); err != nil {
				break
			}
		}
		err = errors.Join(err, s.Err())
	}
	if err == nil {
		var dir *os.File
		dir, err = os.Open(filepath.Dir(path))
		if err == nil {
			err = errors.Join(dir.Sync(), dir.Close())
		}
	}
	if err != nil {
		return nil, errors.Join(err, f.Close())
	}
	return l, nil
}
func (l *Ledger) transition(r Record) error {
	old, exists := l.records[key(r)]
	if exists && (r.RequestID != old.RequestID || r.PlanSHA256 != old.PlanSHA256 || (old.UID != "" && r.UID != old.UID) || old.State == "shared" || old.State == "absent" || (old.State == "owned" && r.State != "absent")) {
		return errors.New("invalid ownership transition")
	}
	if exists && old.State == "intent" && r.State != "owned" && r.State != "absent" {
		return errors.New("intent can only be resolved once")
	}
	if !exists && r.State != "intent" && r.State != "shared" {
		return errors.New("missing durable resource intent")
	}
	if (r.State == "owned" || r.State == "shared") && r.UID == "" {
		return errors.New("missing resource UID")
	}
	l.records[key(r)] = r
	return nil
}
func (l *Ledger) append(r Record) error {
	b, err := json.Marshal(r)
	if err != nil {
		return err
	}
	if err = decode(b, new(Record)); err != nil {
		return err
	}
	before, existed := l.records[key(r)]
	if err = l.transition(r); err != nil {
		return err
	}
	if _, err = l.file.Write(append(b, '\n')); err == nil {
		err = l.file.Sync()
	}
	if err != nil {
		if existed {
			l.records[key(r)] = before
		} else {
			delete(l.records, key(r))
		}
	}
	return err
}
