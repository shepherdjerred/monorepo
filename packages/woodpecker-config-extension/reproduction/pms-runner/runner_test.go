package main

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	backend "go.woodpecker-ci.org/woodpecker/v3/pipeline/backend/types"
	core "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
)

var brokenRead = errors.New("uncertain readback")
var brokenDelete = errors.New("delete denied")

type fakeResources struct {
	uids               map[string]string
	readErr, deleteErr map[string]error
	deleted            []Record
}

func (a *fakeResources) UID(_ context.Context, r Record) (string, error) {
	return a.uids[key(r)], a.readErr[key(r)]
}
func (a *fakeResources) Delete(_ context.Context, r Record) error {
	if err := a.deleteErr[key(r)]; err != nil {
		return err
	}
	if r.UID == "" || a.uids[key(r)] != r.UID {
		return errors.New("UID precondition failed")
	}
	a.deleted = append(a.deleted, r)
	delete(a.uids, key(r))
	return nil
}
func (a *fakeResources) Completed(ctx context.Context, r Record) error {
	uid, err := a.UID(ctx, r)
	if err != nil {
		return err
	}
	if r.UID == "" || uid != r.UID {
		return errors.New("no exact terminal pod")
	}
	return nil
}

type fakeBackend struct {
	backend.Backend
	setup func() error
	wait  func() (*backend.State, error)
}

func (f *fakeBackend) SetupWorkflow(context.Context, *backend.Config, string) error { return f.setup() }
func (f *fakeBackend) WaitStep(context.Context, *backend.Step, string) (*backend.State, error) {
	return f.wait()
}
func testPlan() Plan {
	p := Plan{Kind: "pms-plan", SchemaVersion: 1, Source: strings.Repeat("a", 40), Branch: "feature/media", RequestID: "d10ddcc4-2245-4774-b49a-a4a51abcfaf8", JobImagePullSecrets: []string{"dockerhub-pull-woodpecker-ci"}}
	for i, name := range []string{"clone", "media-pms-wire", "media-pms-native"} {
		p.Steps = append(p.Steps, PlannedStep{Name: name, UUID: p.RequestID + "-" + string(rune('0'+i))})
	}
	return p
}
func harness(t *testing.T) (*ownedBackend, *fakeResources, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "ledger.jsonl")
	l, err := openLedger(path, false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := l.file.Close(); err != nil {
			t.Error(err)
		}
	})
	a := &fakeResources{map[string]string{}, map[string]error{}, map[string]error{}, nil}
	b := &ownedBackend{api: a, ledger: l, plan: testPlan(), hash: strings.Repeat("b", 64)}
	return b, a, path
}
func TestPartialSetupBeforePodIsOwnedAndCleaned(t *testing.T) {
	b, a, _ := harness(t)
	ctx := context.Background()
	if err := b.reserve(ctx); err != nil {
		t.Fatal(err)
	}
	pvc := b.plan.resources(b.hash)[4]
	failure := errors.New("service create failed")
	b.Backend = &fakeBackend{setup: func() error { a.uids[key(pvc)] = "workspace-original"; return failure }}
	if err := b.SetupWorkflow(ctx, &backend.Config{}, b.plan.RequestID); !errors.Is(err, failure) {
		t.Fatal(err)
	}
	if err := b.DestroyWorkflow(ctx, nil, b.plan.RequestID); err != nil {
		t.Fatal(err)
	}
	if len(a.deleted) != 1 || a.deleted[0].UID != "workspace-original" || a.deleted[0].Name != pvc.Name {
		t.Fatalf("wrong deletion: %+v", a.deleted)
	}
}
func TestUncertainReadbackNeverAdoptsAnUnknownUID(t *testing.T) {
	b, a, _ := harness(t)
	ctx := context.Background()
	if err := b.reserve(ctx); err != nil {
		t.Fatal(err)
	}
	pvc := b.plan.resources(b.hash)[4]
	b.Backend = &fakeBackend{setup: func() error { a.uids[key(pvc)] = "unknown"; a.readErr[key(pvc)] = brokenRead; return brokenRead }}
	if err := b.SetupWorkflow(ctx, nil, b.plan.RequestID); !errors.Is(err, brokenRead) {
		t.Fatal(err)
	}
	delete(a.readErr, key(pvc))
	if err := b.DestroyWorkflow(ctx, nil, b.plan.RequestID); err == nil {
		t.Fatal("uncertain ownership passed")
	}
	if len(a.deleted) != 0 {
		t.Fatal("deleted an unrecorded UID")
	}
}
func TestChangedPodUIDProtectsReplacementAndWorkspace(t *testing.T) {
	b, a, _ := harness(t)
	ctx := context.Background()
	if err := b.reserve(ctx); err != nil {
		t.Fatal(err)
	}
	resources := b.plan.resources(b.hash)
	pod, pvc := resources[0], resources[4]
	for _, r := range []Record{pod, pvc} {
		a.uids[key(r)] = "original"
		if err := b.capture(ctx, []Record{r}, nil); err != nil {
			t.Fatal(err)
		}
	}
	a.uids[key(pod)] = "replacement"
	if err := b.DestroyWorkflow(ctx, nil, b.plan.RequestID); err == nil {
		t.Fatal("changed UID passed")
	}
	if len(a.deleted) != 0 {
		t.Fatal("deleted replacement or mounted workspace")
	}
}
func TestCleanupFailureIsJoinedAndDoesNotSkipIndependentResources(t *testing.T) {
	b, a, _ := harness(t)
	ctx := context.Background()
	if err := b.reserve(ctx); err != nil {
		t.Fatal(err)
	}
	resources := b.plan.resources(b.hash)
	for _, r := range resources[3:] {
		a.uids[key(r)] = r.Name
		if err := b.capture(ctx, []Record{r}, nil); err != nil {
			t.Fatal(err)
		}
	}
	a.deleteErr[key(resources[3])] = brokenDelete
	err := b.DestroyWorkflow(ctx, nil, b.plan.RequestID)
	if !errors.Is(err, brokenDelete) || !errors.Is(errors.Join(nil, b.cleanupErr), brokenDelete) {
		t.Fatal("cleanup failure lost")
	}
	if len(a.deleted) != 1 || a.deleted[0].Resource != "persistentvolumeclaims" {
		t.Fatal("independent workspace cleanup skipped")
	}
}
func TestExistingNameAndCreateConflictDoNotGrantOwnership(t *testing.T) {
	b, a, _ := harness(t)
	ctx := context.Background()
	r := b.plan.resources(b.hash)[4]
	a.uids[key(r)] = "foreign"
	if err := b.reserve(ctx); err == nil {
		t.Fatal("preexisting resource accepted")
	}
	delete(a.uids, key(r))
	if err := b.reserve(ctx); err != nil {
		t.Fatal(err)
	}
	a.uids[key(r)] = "raced"
	conflict := apierrors.NewAlreadyExists(schema.GroupResource{Resource: r.Resource}, r.Name)
	if err := b.capture(ctx, []Record{r}, conflict); !apierrors.IsAlreadyExists(err) {
		t.Fatal(err)
	}
	if b.ledger.records[key(r)].UID != "" {
		t.Fatal("conflict adopted")
	}
}
func TestLedgerRestartCleansOnlyOriginalUIDAndNeverSharedCaches(t *testing.T) {
	b, a, path := harness(t)
	ctx := context.Background()
	b.plan.Steps[1].Volumes = []string{"woodpecker-bun-cache:/cache/bun"}
	a.uids["persistentvolumeclaims/woodpecker-bun-cache"] = "shared-original"
	if err := b.reserve(ctx); err != nil {
		t.Fatal(err)
	}
	r := b.plan.resources(b.hash)[4]
	a.uids[key(r)] = "owned-original"
	if err := b.capture(ctx, []Record{r}, nil); err != nil {
		t.Fatal(err)
	}
	l, err := openLedger(path, true)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := l.file.Close(); err != nil {
			t.Error(err)
		}
	}()
	resumed := &ownedBackend{api: a, ledger: l, plan: b.plan, hash: b.hash}
	if err = resumed.DestroyWorkflow(ctx, nil, b.plan.RequestID); err != nil {
		t.Fatal(err)
	}
	if len(a.deleted) != 1 || a.deleted[0].UID != "owned-original" || a.uids["persistentvolumeclaims/woodpecker-bun-cache"] != "shared-original" {
		t.Fatal("cleanup crossed ownership")
	}
}
func TestDisappearedStepCannotBecomeSuccess(t *testing.T) {
	b, _, _ := harness(t)
	b.Backend = &fakeBackend{wait: func() (*backend.State, error) { return &backend.State{Exited: true, ExitCode: 0}, nil }}
	if _, err := b.WaitStep(context.Background(), &backend.Step{UUID: b.plan.Steps[0].UUID}, b.plan.RequestID); err == nil {
		t.Fatal("missing pod accepted")
	}
}
func TestActualKubernetesDeleteCarriesExactUIDPrecondition(t *testing.T) {
	p := testPlan()
	r := p.resources(strings.Repeat("b", 64))[4]
	r.State = "owned"
	r.UID = "owned-workspace-uid"
	client := fake.NewSimpleClientset(&core.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: r.Name, Namespace: namespace, UID: types.UID(r.UID)}})
	k := &kubeResources{client: client, plan: p}
	if err := k.Delete(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	deletes := 0
	for _, action := range client.Actions() {
		if action.GetVerb() == "delete" {
			deleteAction, ok := action.(clienttesting.DeleteAction)
			if !ok {
				t.Fatal("unexpected delete action")
			}
			options := deleteAction.GetDeleteOptions()
			if options.Preconditions == nil || options.Preconditions.UID == nil || string(*options.Preconditions.UID) != r.UID || deleteAction.GetName() != r.Name || action.GetNamespace() != namespace {
				t.Fatal("delete lost exact UID/namespace/name")
			}
			deletes++
		}
	}
	if deletes != 1 {
		t.Fatalf("expected one owned delete, got %d", deletes)
	}
}
func TestCompiledPolicyRejectsCredentialPlacementAndResourceDrift(t *testing.T) {
	p := testPlan()
	e := p.Steps[1]
	e.Image = "image@sha256:" + strings.Repeat("c", 64)
	e.Commands = []string{"exact reviewed command"}
	e.Resources = map[string]map[string]string{"requests": {"cpu": "1", "memory": "2Gi", "ephemeral-storage": "1Gi"}, "limits": {"cpu": "2", "memory": "4Gi", "ephemeral-storage": "4Gi"}}
	options := map[string]any{"kubernetes": map[string]any{"resources": e.Resources, "nodeSelector": map[string]string{"kubernetes.io/hostname": "liskov"}, "serviceAccountName": "woodpecker-job", "tolerations": []map[string]string{{"key": "ci", "operator": "Equal", "value": "only", "effect": "NoSchedule"}}, "labels": map[string]string{"ci.sjer.red/step-key": "media-pms-wire", "ci.sjer.red/commit": p.Source}, "annotations": map[string]string{"ci.sjer.red/branch": p.Branch, "ci.sjer.red/event": "manual"}}}
	s := backend.Step{Name: e.Name, Type: backend.StepTypeCommands, Image: e.Image, Commands: e.Commands, OnSuccess: true, Failure: "fail", Volumes: []string{"pms-" + p.RequestID + "_default:/woodpecker"}, Environment: map[string]string{"CI_COMMIT_SHA": p.Source, "CI_SYSTEM_PLATFORM": "linux/amd64"}, BackendOptions: options}
	if err := validateStep(p, e, &s); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"secrets", "serviceAccountName", "nodeSelector", "resources"} {
		t.Run(field, func(t *testing.T) {
			b, err := json.Marshal(options)
			if err != nil {
				t.Fatal(err)
			}
			var changed map[string]any
			if err = json.Unmarshal(b, &changed); err != nil {
				t.Fatal(err)
			}
			inner, ok := changed["kubernetes"].(map[string]any)
			if !ok {
				t.Fatal("missing backend")
			}
			inner[field] = "unexpected"
			s.BackendOptions = changed
			if err = validateStep(p, e, &s); err == nil {
				t.Fatal("changed policy accepted")
			}
		})
	}
	args := backendArguments(p)
	for _, want := range []string{"--backend-k8s-namespace=woodpecker-ci", "--backend-k8s-priority-class=batch-low", "--backend-k8s-allow-native-secrets=false", "--backend-k8s-pod-labels={\"kueue.x-k8s.io/queue-name\":\"default\"}"} {
		found := false
		for _, arg := range args {
			found = found || arg == want
		}
		if !found {
			t.Fatalf("missing policy %s", want)
		}
	}
	if !reflect.DeepEqual(p.resources("x")[4].Name, "pms-"+p.RequestID+"-default") {
		t.Fatal("workspace identity differs")
	}
}

// Typed post-admission shape: ServiceAccount admission copies only these image
// pull refs into the pod. No pull credential value or service-account token is mounted.
func defaultedJobPod() (Plan, *core.ServiceAccount, *core.Pod) {
	p := testPlan()
	step := &p.Steps[1]
	step.Image = "image@sha256:" + strings.Repeat("c", 64)
	step.Resources = map[string]map[string]string{
		"requests": {"cpu": "1", "memory": "2Gi", "ephemeral-storage": "1Gi"},
		"limits":   {"cpu": "2", "memory": "4Gi", "ephemeral-storage": "4Gi"},
	}
	tokenless := false
	account := &core.ServiceAccount{
		ObjectMeta:                   metav1.ObjectMeta{Name: "woodpecker-job", Namespace: namespace},
		AutomountServiceAccountToken: &tokenless,
		ImagePullSecrets:             []core.LocalObjectReference{{Name: "dockerhub-pull-woodpecker-ci"}},
	}
	container := core.Container{
		Name: "container-0", Image: step.Image,
		Resources:    core.ResourceRequirements{Requests: core.ResourceList{}, Limits: core.ResourceList{}},
		VolumeMounts: []core.VolumeMount{{Name: "workspace", MountPath: "/woodpecker"}},
	}
	for key, value := range step.Resources["requests"] {
		container.Resources.Requests[core.ResourceName(key)] = resource.MustParse(value)
	}
	for key, value := range step.Resources["limits"] {
		container.Resources.Limits[core.ResourceName(key)] = resource.MustParse(value)
	}
	pod := &core.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: "wp-" + step.UUID, Namespace: namespace, UID: types.UID("admitted-owned-pod"),
			Labels: map[string]string{
				"woodpecker-ci.org/task-uuid":   p.RequestID,
				"kueue.x-k8s.io/queue-name":     "default",
				"kueue.x-k8s.io/priority-class": "ci-draft",
				"ci.sjer.red/step-key":          "media-pms-wire", "ci.sjer.red/commit": p.Source,
			},
			Annotations: map[string]string{"ci.sjer.red/branch": p.Branch, "ci.sjer.red/event": "manual"},
		},
		Spec: core.PodSpec{
			ServiceAccountName: "woodpecker-job",
			ImagePullSecrets:   append([]core.LocalObjectReference(nil), account.ImagePullSecrets...),
			NodeSelector:       map[string]string{"kubernetes.io/hostname": "liskov", core.LabelArchStable: "amd64"},
			PriorityClassName:  "batch-low", RestartPolicy: core.RestartPolicyNever,
			Containers: []core.Container{container},
			Volumes: []core.Volume{{Name: "workspace", VolumeSource: core.VolumeSource{
				PersistentVolumeClaim: &core.PersistentVolumeClaimVolumeSource{ClaimName: "pms-" + p.RequestID + "-default"},
			}}},
		},
	}
	return p, account, pod
}

func TestDefaultedJobPullSecretIsOwnedAndCleaned(t *testing.T) {
	b, _, _ := harness(t)
	p, account, pod := defaultedJobPod()
	b.plan = p
	if err := validateJobAccount(account, p); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := b.reserve(ctx); err != nil {
		t.Fatal(err)
	}
	client := fake.NewSimpleClientset(pod)
	b.api = &kubeResources{client: client, plan: p}
	r := p.resources(b.hash)[1]
	if err := b.capture(ctx, []Record{r}, nil); err != nil {
		t.Fatal(err)
	}
	if got := b.ledger.records[key(r)]; got.State != "owned" || got.UID != string(pod.UID) {
		t.Fatalf("defaulted pod did not retain its exact owned UID: %+v", got)
	}
	if err := b.DestroyStep(ctx, &backend.Step{UUID: p.Steps[1].UUID}, p.RequestID); err != nil {
		t.Fatal(err)
	}
	if _, err := client.CoreV1().Pods(namespace).Get(ctx, pod.Name, metav1.GetOptions{}); !apierrors.IsNotFound(err) {
		t.Fatalf("owned defaulted pod was not removed: %v", err)
	}
	if b.ledger.records[key(r)].State != "absent" {
		t.Fatal("cleanup did not durably record absence")
	}
}

func TestJobAccountRequiresExactReviewedPullReferencesAndNoToken(t *testing.T) {
	p, account, _ := defaultedJobPod()
	cases := map[string]func(*core.ServiceAccount){
		"missing":    func(a *core.ServiceAccount) { a.ImagePullSecrets = nil },
		"unapproved": func(a *core.ServiceAccount) { a.ImagePullSecrets[0].Name = "unapproved" },
		"additional": func(a *core.ServiceAccount) {
			a.ImagePullSecrets = append(a.ImagePullSecrets, core.LocalObjectReference{Name: "unapproved"})
		},
		"implicit token": func(a *core.ServiceAccount) { a.AutomountServiceAccountToken = nil },
		"enabled token":  func(a *core.ServiceAccount) { enabled := true; a.AutomountServiceAccountToken = &enabled },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			changed := account.DeepCopy()
			change(changed)
			if err := validateJobAccount(changed, p); err == nil {
				t.Fatal("unreviewed account accepted")
			}
		})
	}
}

func TestAdmittedPodRejectsUnapprovedPullReferencesAndMountedCredentials(t *testing.T) {
	p, _, pod := defaultedJobPod()
	cases := map[string]func(*core.Pod){
		"missing":    func(p *core.Pod) { p.Spec.ImagePullSecrets = nil },
		"unapproved": func(p *core.Pod) { p.Spec.ImagePullSecrets[0].Name = "unapproved" },
		"additional": func(p *core.Pod) {
			p.Spec.ImagePullSecrets = append(p.Spec.ImagePullSecrets, core.LocalObjectReference{Name: "unapproved"})
		},
		"secret environment": func(p *core.Pod) {
			p.Spec.Containers[0].Env = []core.EnvVar{{Name: "CREDENTIAL", ValueFrom: &core.EnvVarSource{
				SecretKeyRef: &core.SecretKeySelector{LocalObjectReference: core.LocalObjectReference{Name: "unapproved"}, Key: "value"},
			}}}
		},
		"secret volume": func(p *core.Pod) {
			p.Spec.Volumes = append(p.Spec.Volumes, core.Volume{Name: "unapproved", VolumeSource: core.VolumeSource{Secret: &core.SecretVolumeSource{SecretName: "unapproved"}}})
		},
		"enabled token": func(p *core.Pod) { enabled := true; p.Spec.AutomountServiceAccountToken = &enabled },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			changed := pod.DeepCopy()
			change(changed)
			k := &kubeResources{client: fake.NewSimpleClientset(changed), plan: p}
			uid, err := k.UID(context.Background(), p.resources(strings.Repeat("b", 64))[1])
			if err == nil || uid != "" {
				t.Fatalf("unreviewed pod granted ownership: %q, %v", uid, err)
			}
		})
	}
}
