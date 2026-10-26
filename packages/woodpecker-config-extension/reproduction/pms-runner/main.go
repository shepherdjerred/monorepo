package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"reflect"
	"runtime/debug"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/urfave/cli/v3"
	kubeBackend "go.woodpecker-ci.org/woodpecker/v3/pipeline/backend/kubernetes"
	backend "go.woodpecker-ci.org/woodpecker/v3/pipeline/backend/types"
	"go.woodpecker-ci.org/woodpecker/v3/pipeline/frontend/builder"
	"go.woodpecker-ci.org/woodpecker/v3/pipeline/frontend/metadata"
	"go.woodpecker-ci.org/woodpecker/v3/pipeline/frontend/yaml/compiler"
	runner "go.woodpecker-ci.org/woodpecker/v3/pipeline/runtime"
)

// Set only by the reviewed build. This binary accepts one plan, not arbitrary YAML.
var runnerSource string
var reviewedPlanSHA256 string

func compilePlan(p Plan, yaml []byte) (*backend.Config, error) {
	m := metadata.Metadata{
		Repo: metadata.Repo{Name: "monorepo", Owner: "shepherdjerred", Branch: "main", CloneURL: "https://github.com/shepherdjerred/monorepo.git"},
		Curr: metadata.Pipeline{Event: "manual", Status: "success", Commit: metadata.Commit{Sha: p.Source, Branch: p.Branch, Ref: "refs/heads/" + p.Branch}},
		Sys:  metadata.System{Name: "pms-component-reproduction", Platform: "linux/amd64", Version: "3.19.0"},
	}
	b := builder.PipelineBuilder{
		Yamls:               []*builder.YamlFile{{Name: "media-pms-wire", Data: yaml}},
		RepoTrusted:         &metadata.TrustedConfiguration{Volumes: true},
		TrustedClonePlugins: []string{p.Steps[0].Image},
		CompilerOptions:     []compiler.Option{compiler.WithPrefix("pms-" + p.RequestID), compiler.WithLocal(false), compiler.WithWorkspace("/woodpecker", "src")},
		GetWorkflowMetadata: func(*builder.Workflow) metadata.Metadata { return m },
	}
	items, err := b.Build()
	if err != nil {
		return nil, err
	}
	if len(items) != 1 || items[0].ConcurrencyLimit != 1 || items[0].ConcurrencyGroup != "media-pms-wire" || len(items[0].DependsOn) != 0 {
		return nil, errors.New("expected one standalone PMS workflow")
	}
	if items[0].Labels["backend"] != "kubernetes" || items[0].Labels["ci-pool"] != "pr" || items[0].Labels["kueue.x-k8s.io/priority-class"] != "ci-draft" {
		return nil, errors.New("workflow routing differs")
	}
	config := items[0].Config
	if len(config.Secrets) != 0 || config.Volume != "pms-"+p.RequestID+"_default" {
		return nil, errors.New("unexpected credentials/workspace")
	}
	index := 0
	for _, stage := range config.Stages {
		if len(stage.Steps) != 1 {
			return nil, errors.New("PMS stages must be sequential")
		}
		for _, step := range stage.Steps {
			if index >= len(p.Steps) {
				return nil, errors.New("extra compiled step")
			}
			expected := p.Steps[index]
			index++
			if err = validateStep(p, expected, step); err != nil {
				return nil, err
			}
			step.UUID = expected.UUID
			step.WorkflowLabels = items[0].Labels
		}
	}
	if index != 3 {
		return nil, errors.New("missing compiled step")
	}
	return config, nil
}
func validateStep(p Plan, expected PlannedStep, s *backend.Step) error {
	expectedType := backend.StepTypeCommands
	if expected.Name == "clone" {
		expectedType = backend.StepTypeClone
	}
	if s.Type != expectedType {
		return errors.New("compiled step role differs")
	}
	if s.Name != expected.Name || s.Image != expected.Image || !slices.Equal(s.Commands, expected.Commands) || s.Detached || s.Privileged || s.OnFailure || !s.OnSuccess || s.Failure != "fail" || len(s.SecretMapping) != 0 || !reflect.ValueOf(s.AuthConfig).IsZero() || len(s.Entrypoint) != 0 || len(s.ExtraHosts) != 0 || len(s.Tmpfs) != 0 || len(s.Devices) != 0 || len(s.Ports) != 0 || s.NetworkMode != "" {
		return errors.New("compiled command/image/security differs")
	}
	volumes := append([]string{"pms-" + p.RequestID + "_default:/woodpecker"}, expected.Volumes...)
	if !slices.Equal(s.Volumes, volumes) || s.Environment["CI_COMMIT_SHA"] != p.Source || s.Environment["CI_SYSTEM_PLATFORM"] != "linux/amd64" {
		return errors.New("compiled source/platform/volumes differ")
	}
	var options struct {
		Kubernetes struct {
			Resources          map[string]map[string]string `json:"resources"`
			NodeSelector       map[string]string            `json:"nodeSelector"`
			Tolerations        []map[string]string          `json:"tolerations"`
			ServiceAccountName string                       `json:"serviceAccountName"`
			Labels             map[string]string            `json:"labels"`
			Annotations        map[string]string            `json:"annotations"`
		} `json:"kubernetes"`
	}
	b, err := json.Marshal(s.BackendOptions)
	if err != nil {
		return err
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err = d.Decode(&options); err != nil {
		return err
	}
	o := options.Kubernetes
	if !reflect.DeepEqual(o.Resources, expected.Resources) || !reflect.DeepEqual(o.NodeSelector, map[string]string{"kubernetes.io/hostname": "liskov"}) || o.ServiceAccountName != "woodpecker-job" || !reflect.DeepEqual(o.Tolerations, []map[string]string{{"key": "ci", "operator": "Equal", "value": "only", "effect": "NoSchedule"}}) {
		return errors.New("compiled resource/placement/tokenless policy differs")
	}
	label := "media-pms-wire"
	if expected.Name == "media-pms-native" {
		label = expected.Name
	}
	if !reflect.DeepEqual(o.Labels, map[string]string{"ci.sjer.red/step-key": label, "ci.sjer.red/commit": p.Source}) || o.Annotations["ci.sjer.red/branch"] != p.Branch || o.Annotations["ci.sjer.red/event"] != "manual" {
		return errors.New("compiled attribution differs")
	}
	return nil
}
func backendArguments(p Plan) []string {
	return []string{"pms-runner", "--backend-k8s-namespace=woodpecker-ci", "--backend-k8s-namespace-per-org=false",
		"--backend-k8s-storage-class=ci-workspace", "--backend-k8s-volume-size=32G", "--backend-k8s-storage-rwx=true",
		"--backend-k8s-priority-class=batch-low", "--backend-k8s-allow-native-secrets=false",
		"--backend-k8s-pod-labels={\"kueue.x-k8s.io/queue-name\":\"default\"}",
		"--backend-k8s-pod-node-selector={\"kubernetes.io/hostname\":\"liskov\"}",
		"--backend-k8s-pod-tolerations=[{\"key\":\"ci\",\"operator\":\"Equal\",\"value\":\"only\",\"effect\":\"NoSchedule\"}]",
		"--backend-k8s-pod-labels-allow-from-step=true", "--backend-k8s-pod-annotations-allow-from-step=true",
		"--backend-k8s-pod-node-selector-allow-from-step=true", "--backend-k8s-pod-tolerations-allow-from-step=true",
		"--backend-k8s-service-account-name-allow-from-step=true", "--backend-k8s-permission-init-image=" + p.PermissionImage}
}
func run(ctx context.Context, args []string) (result error) {
	if len(args) != 4 || (args[0] != "run" && args[0] != "cleanup") {
		return errors.New("usage: pms-runner run|cleanup PLAN YAML LEDGER")
	}
	if err := rejectBackendEnvironment(); err != nil {
		return err
	}
	p, yaml, hash, err := loadPlan(args[1], args[2])
	if err != nil {
		return err
	}
	if p.Source != runnerSource {
		return errors.New("runner must be built from the exact reviewed source revision")
	}
	if hash != reviewedPlanSHA256 {
		return errors.New("runner accepts only its compiled-in reviewed plan digest")
	}
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return errors.New("missing build provenance")
	}
	pinned := false
	for _, dep := range info.Deps {
		if dep.Path == "go.woodpecker-ci.org/woodpecker/v3" {
			pinned = dep.Version == "v3.19.0" && dep.Replace == nil
		}
	}
	if !pinned {
		return errors.New("runner backend is not pinned Woodpecker v3.19.0")
	}
	config, err := compilePlan(p, yaml)
	if err != nil {
		return err
	}
	api, err := newKubeResources(ctx, p)
	if err != nil {
		return err
	}
	l, err := openLedger(args[3], args[0] == "cleanup")
	if err != nil {
		return err
	}
	defer func() { result = errors.Join(result, l.file.Close()) }()
	b := &ownedBackend{api: api, ledger: l, plan: p, hash: hash}
	if args[0] == "cleanup" {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
		defer cancel()
		return b.DestroyWorkflow(cleanupCtx, config, p.RequestID)
	}
	if err = b.reserve(ctx); err != nil {
		return err
	}
	b.Backend = kubeBackend.New()
	command := &cli.Command{Flags: b.Flags(), Action: func(ctx context.Context, c *cli.Command) error {
		ctx = context.WithValue(ctx, backend.CliCommand, c)
		if _, err := b.Load(ctx); err != nil {
			return err
		}
		workCtx, cancel := context.WithTimeout(ctx, 20*time.Minute)
		defer cancel()
		r := runner.New(config, b, runner.WithContext(workCtx), runner.WithTaskUUID(p.RequestID), runner.WithLogger(func(_ *backend.Step, logs io.ReadCloser) error {
			// Only this credentialless lane's bounded stdout; the PMS harness sanitizes its report.
			n, err := io.Copy(os.Stdout, io.LimitReader(logs, 8<<20+1))
			closeErr := logs.Close()
			if n > 8<<20 {
				err = errors.Join(err, errors.New("step log exceeded bounded output"))
			}
			return errors.Join(err, closeErr)
		}))
		return errors.Join(r.Run(context.WithoutCancel(ctx)), r.Err(), b.cleanupErr)
	}}
	err = command.Run(ctx, backendArguments(p))
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
	defer cancel()
	return errors.Join(err, b.DestroyWorkflow(cleanupCtx, config, p.RequestID), b.cleanupErr)
}
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, strings.TrimSpace(err.Error()))
		os.Exit(1)
	}
}
