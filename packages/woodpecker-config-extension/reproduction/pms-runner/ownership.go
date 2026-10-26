package main

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	backend "go.woodpecker-ci.org/woodpecker/v3/pipeline/backend/types"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

type ResourceAPI interface {
	UID(context.Context, Record) (string, error)
	Delete(context.Context, Record) error
	Completed(context.Context, Record) error
}
type ownedBackend struct {
	backend.Backend
	api        ResourceAPI
	ledger     *Ledger
	plan       Plan
	hash       string
	mu         sync.Mutex
	cleanupErr error
}

func (b *ownedBackend) reserve(ctx context.Context) error {
	for _, r := range b.plan.resources(b.hash) {
		uid, err := b.api.UID(ctx, r)
		if err != nil {
			return err
		}
		if uid != "" {
			return fmt.Errorf("resource already exists: %s", key(r))
		}
	}
	for _, name := range b.plan.caches() {
		r := Record{"pms-resource", 1, b.plan.RequestID, b.hash, "persistentvolumeclaims", name, "", "shared"}
		uid, err := b.api.UID(ctx, r)
		if err != nil {
			return err
		}
		if uid == "" {
			return errors.New("required shared cache missing")
		}
		r.UID = uid
		if err = b.ledger.append(r); err != nil {
			return err
		}
	}
	for _, r := range b.plan.resources(b.hash) {
		if err := b.ledger.append(r); err != nil {
			return err
		}
	}
	return nil
}
func (b *ownedBackend) capture(ctx context.Context, resources []Record, createErr error) error {
	// A create conflict cannot establish ownership, even when the shape matches.
	if apierrors.IsAlreadyExists(createErr) {
		return createErr
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	var errs []error
	for _, expected := range resources {
		r := b.ledger.records[key(expected)]
		if r.State != "intent" {
			errs = append(errs, errors.New("create without original intent"))
			continue
		}
		uid, err := b.api.UID(ctx, r)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if uid == "" {
			if createErr == nil {
				errs = append(errs, errors.New("successful create missing on readback"))
			}
			continue
		}
		r.State, r.UID = "owned", uid
		errs = append(errs, b.ledger.append(r))
	}
	return errors.Join(append(errs, createErr)...)
}
func (b *ownedBackend) SetupWorkflow(ctx context.Context, config *backend.Config, task string) error {
	if task != b.plan.RequestID {
		return errors.New("wrong workflow identity")
	}
	err := b.Backend.SetupWorkflow(ctx, config, task)
	readCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 20*time.Second)
	defer cancel()
	return b.capture(readCtx, b.plan.resources(b.hash)[3:], err)
}
func (b *ownedBackend) StartStep(ctx context.Context, step *backend.Step, task string) error {
	if task != b.plan.RequestID {
		return errors.New("wrong task identity")
	}
	b.mu.Lock()
	r, ok := b.ledger.records["pods/wp-"+step.UUID]
	b.mu.Unlock()
	if !ok || r.State != "intent" {
		return errors.New("step has no reserved intent")
	}
	err := b.Backend.StartStep(ctx, step, task)
	readCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 20*time.Second)
	defer cancel()
	return b.capture(readCtx, []Record{r}, err)
}
func (b *ownedBackend) WaitStep(ctx context.Context, step *backend.Step, task string) (*backend.State, error) {
	state, err := b.Backend.WaitStep(ctx, step, task)
	if err != nil {
		return state, err
	}
	// Upstream reports a disappeared pod as success. Require this owned pod's real terminal state.
	b.mu.Lock()
	r := b.ledger.records["pods/wp-"+step.UUID]
	b.mu.Unlock()
	if err = b.api.Completed(ctx, r); err != nil {
		return state, err
	}
	return state, nil
}
func (b *ownedBackend) remove(ctx context.Context, expected Record) error {
	r, ok := b.ledger.records[key(expected)]
	if !ok {
		return errors.New("missing cleanup intent")
	}
	if r.RequestID != b.plan.RequestID || r.PlanSHA256 != b.hash || r.State == "shared" {
		return errors.New("foreign cleanup record")
	}
	uid, err := b.api.UID(ctx, r)
	if err != nil {
		return err
	}
	if r.State == "absent" {
		if uid != "" {
			return errors.New("resource recreated after deletion")
		}
		return nil
	}
	if uid != "" {
		if r.State != "owned" || r.UID == "" || uid != r.UID {
			return fmt.Errorf("unresolved or changed UID: %s", key(r))
		}
		if err = b.api.Delete(ctx, r); err != nil {
			return err
		}
	}
	r.State = "absent"
	return b.ledger.append(r)
}
func (b *ownedBackend) DestroyStep(ctx context.Context, step *backend.Step, task string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if task != b.plan.RequestID {
		return errors.New("wrong cleanup task")
	}
	r := Record{Resource: "pods", Name: "wp-" + step.UUID}
	err := b.remove(ctx, r)
	b.cleanupErr = errors.Join(b.cleanupErr, err)
	return err
}
func (b *ownedBackend) DestroyWorkflow(ctx context.Context, _ *backend.Config, task string) error {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
	defer cancel()
	b.mu.Lock()
	defer b.mu.Unlock()
	if task != b.plan.RequestID {
		return errors.New("wrong cleanup task")
	}
	if err := b.validateLedger(); err != nil {
		b.cleanupErr = errors.Join(b.cleanupErr, err)
		return err
	}
	var podErr, otherErr error
	resources := b.plan.resources(b.hash)
	for _, r := range resources[:3] {
		podErr = errors.Join(podErr, b.remove(ctx, r))
	}
	otherErr = errors.Join(otherErr, b.remove(ctx, resources[3]))
	// A workspace is not deleted until every owned pod is confirmed absent.
	if podErr == nil {
		otherErr = errors.Join(otherErr, b.remove(ctx, resources[4]))
	}
	for _, r := range b.ledger.records {
		if r.State == "shared" {
			uid, err := b.api.UID(ctx, r)
			otherErr = errors.Join(otherErr, err)
			if uid != r.UID {
				otherErr = errors.Join(otherErr, fmt.Errorf("shared cache UID changed: %s", r.Name))
			}
		}
	}
	err := errors.Join(podErr, otherErr)
	b.cleanupErr = errors.Join(b.cleanupErr, err)
	return err
}
func (b *ownedBackend) validateLedger() error {
	expected := map[string]bool{}
	for _, r := range b.plan.resources(b.hash) {
		expected[key(r)] = false
	}
	for _, name := range b.plan.caches() {
		expected["persistentvolumeclaims/"+name] = true
	}
	for name, r := range b.ledger.records {
		shared, known := expected[name]
		if !known || r.RequestID != b.plan.RequestID || r.PlanSHA256 != b.hash || (r.State == "shared") != shared {
			return errors.New("ledger differs from exact reviewed request")
		}
	}
	return nil
}
