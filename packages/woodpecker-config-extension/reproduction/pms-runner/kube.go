package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"reflect"
	"slices"
	"strings"
	"time"

	core "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

const namespace = "woodpecker-ci"

type kubeResources struct {
	client kubernetes.Interface
	plan   Plan
}

func newKubeResources(ctx context.Context, p Plan) (*kubeResources, error) {
	if os.Getenv("KUBERNETES_SERVICE_HOST") != "" {
		return nil, errors.New("operator reproduction must run outside the cluster")
	}
	path := os.Getenv("KUBECONFIG")
	if path == "" {
		path = os.Getenv("HOME") + "/.kube/config"
	}
	// This is the same public config loader and path rule as pinned backend 3.19.
	config, err := clientcmd.BuildConfigFromFlags("", path)
	if err != nil {
		return nil, err
	}
	config.Timeout = 20 * time.Second
	client, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, err
	}
	account, err := client.CoreV1().ServiceAccounts(namespace).Get(ctx, "woodpecker-job", metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	if err = validateJobAccount(account, p); err != nil {
		return nil, err
	}
	return &kubeResources{client, p}, nil
}

func validateJobAccount(account *core.ServiceAccount, p Plan) error {
	if account.Name != "woodpecker-job" || account.Namespace != namespace ||
		account.AutomountServiceAccountToken == nil || *account.AutomountServiceAccountToken {
		return errors.New("job account is not the exact tokenless identity")
	}
	if !matchesImagePullSecrets(account.ImagePullSecrets, p.JobImagePullSecrets) {
		return errors.New("job account image pull references differ from the reviewed plan")
	}
	return nil
}

func matchesImagePullSecrets(actual []core.LocalObjectReference, expected []string) bool {
	if len(actual) != len(expected) {
		return false
	}
	for i, reference := range actual {
		if reference.Name != expected[i] {
			return false
		}
	}
	return true
}
func (k *kubeResources) UID(ctx context.Context, r Record) (string, error) {
	var uid types.UID
	switch r.Resource {
	case "pods":
		p, err := k.client.CoreV1().Pods(namespace).Get(ctx, r.Name, metav1.GetOptions{})
		if apierrors.IsNotFound(err) {
			return "", nil
		}
		if err != nil {
			return "", err
		}
		if err = k.validPod(p); err != nil {
			return "", err
		}
		uid = p.UID
	case "services":
		s, err := k.client.CoreV1().Services(namespace).Get(ctx, r.Name, metav1.GetOptions{})
		if apierrors.IsNotFound(err) {
			return "", nil
		}
		if err != nil {
			return "", err
		}
		if s.Name != "wp-hsvc-"+k.plan.RequestID || s.Spec.ClusterIP != "None" || !reflect.DeepEqual(s.Spec.Selector, map[string]string{"woodpecker-ci.org/task-uuid": k.plan.RequestID}) || len(s.Spec.Ports) != 0 {
			return "", errors.New("headless service identity changed")
		}
		uid = s.UID
	case "persistentvolumeclaims":
		p, err := k.client.CoreV1().PersistentVolumeClaims(namespace).Get(ctx, r.Name, metav1.GetOptions{})
		if apierrors.IsNotFound(err) {
			return "", nil
		}
		if err != nil {
			return "", err
		}
		if r.State == "shared" {
			if !slices.Contains(k.plan.caches(), r.Name) {
				return "", errors.New("unknown shared cache")
			}
		} else {
			quantity := p.Spec.Resources.Requests[core.ResourceStorage]
			if p.Name != "pms-"+k.plan.RequestID+"-default" || p.Spec.StorageClassName == nil || *p.Spec.StorageClassName != "ci-workspace" || !slices.Equal(p.Spec.AccessModes, []core.PersistentVolumeAccessMode{core.ReadWriteMany}) || quantity.Cmp(resource.MustParse("32G")) != 0 {
				return "", errors.New("workspace identity changed")
			}
		}
		uid = p.UID
	default:
		return "", errors.New("unknown resource kind")
	}
	if uid == "" {
		return "", errors.New("empty Kubernetes UID")
	}
	return string(uid), nil
}
func (k *kubeResources) validPod(p *core.Pod) error {
	var expected *PlannedStep
	for i := range k.plan.Steps {
		if p.Name == "wp-"+k.plan.Steps[i].UUID {
			expected = &k.plan.Steps[i]
		}
	}
	if expected == nil {
		return errors.New("pod outside request")
	}
	labels := map[string]string{"woodpecker-ci.org/task-uuid": k.plan.RequestID, "kueue.x-k8s.io/queue-name": "default", "kueue.x-k8s.io/priority-class": "ci-draft", "ci.sjer.red/step-key": "media-pms-wire", "ci.sjer.red/commit": k.plan.Source}
	if expected.Name == "media-pms-native" {
		labels["ci.sjer.red/step-key"] = expected.Name
	}
	for name, value := range labels {
		if p.Labels[name] != value {
			return fmt.Errorf("pod attribution differs: %s", name)
		}
	}
	if p.Annotations["ci.sjer.red/branch"] != k.plan.Branch || p.Annotations["ci.sjer.red/event"] != "manual" || p.Spec.NodeSelector["kubernetes.io/hostname"] != "liskov" || p.Spec.NodeSelector[core.LabelArchStable] != "amd64" || p.Spec.PriorityClassName != "batch-low" || p.Spec.ServiceAccountName != "woodpecker-job" || (p.Spec.AutomountServiceAccountToken != nil && *p.Spec.AutomountServiceAccountToken) || p.Spec.HostNetwork || p.Spec.HostPID || p.Spec.HostIPC || len(p.Spec.Containers) != 1 || len(p.Spec.EphemeralContainers) != 0 || !matchesImagePullSecrets(p.Spec.ImagePullSecrets, k.plan.JobImagePullSecrets) {
		return errors.New("pod isolation/policy changed")
	}
	allowed := append([]string{"pms-" + k.plan.RequestID + "-default"}, k.plan.caches()...)
	for _, volume := range p.Spec.Volumes {
		if volume.PersistentVolumeClaim == nil || !slices.Contains(allowed, volume.PersistentVolumeClaim.ClaimName) {
			return errors.New("unexpected pod volume")
		}
	}
	container := p.Spec.Containers[0]
	if container.Image != expected.Image || len(container.EnvFrom) != 0 {
		return errors.New("pod image or environment source changed")
	}
	for _, env := range container.Env {
		if env.ValueFrom != nil {
			return errors.New("credential reference in tokenless pod")
		}
	}
	if container.SecurityContext != nil && container.SecurityContext.Privileged != nil && *container.SecurityContext.Privileged {
		return errors.New("privileged pod")
	}
	for name, expectedValues := range expected.Resources {
		actual := container.Resources.Requests
		if name == "limits" {
			actual = container.Resources.Limits
		}
		for key, value := range expectedValues {
			quantity := actual[core.ResourceName(key)]
			if quantity.Cmp(resource.MustParse(value)) != 0 {
				return errors.New("pod resources changed")
			}
		}
	}
	for _, init := range p.Spec.InitContainers {
		if init.Image != k.plan.PermissionImage {
			return errors.New("unreviewed permission image")
		}
	}
	return nil
}
func (k *kubeResources) Completed(ctx context.Context, r Record) error {
	if r.State != "owned" || r.UID == "" {
		return errors.New("terminal step has no owned UID")
	}
	p, err := k.client.CoreV1().Pods(namespace).Get(ctx, r.Name, metav1.GetOptions{})
	if err != nil {
		return err
	}
	if string(p.UID) != r.UID {
		return errors.New("terminal pod UID changed")
	}
	if err = k.validPod(p); err != nil {
		return err
	}
	if p.Status.Phase != core.PodSucceeded || len(p.Status.ContainerStatuses) != 1 || p.Status.ContainerStatuses[0].State.Terminated == nil || p.Status.ContainerStatuses[0].State.Terminated.ExitCode != 0 {
		return errors.New("PMS step did not terminate successfully")
	}
	return nil
}
func (k *kubeResources) Delete(ctx context.Context, r Record) error {
	if r.State != "owned" || r.UID == "" || slices.Contains(k.plan.caches(), r.Name) {
		return errors.New("delete requires request-owned UID")
	}
	uid := types.UID(r.UID)
	grace := int64(20)
	opts := metav1.DeleteOptions{Preconditions: &metav1.Preconditions{UID: &uid}, GracePeriodSeconds: &grace}
	var err error
	switch r.Resource {
	case "pods":
		err = k.client.CoreV1().Pods(namespace).Delete(ctx, r.Name, opts)
	case "services":
		err = k.client.CoreV1().Services(namespace).Delete(ctx, r.Name, opts)
	case "persistentvolumeclaims":
		err = k.client.CoreV1().PersistentVolumeClaims(namespace).Delete(ctx, r.Name, opts)
	default:
		return errors.New("unknown delete kind")
	}
	if err != nil && !apierrors.IsNotFound(err) {
		return err
	}
	return wait.PollUntilContextTimeout(ctx, 250*time.Millisecond, 30*time.Second, true, func(ctx context.Context) (bool, error) {
		current, err := k.UID(ctx, r)
		if err != nil {
			return false, err
		}
		if current == "" {
			return true, nil
		}
		if current != r.UID {
			return false, errors.New("UID replaced while waiting for deletion")
		}
		return false, nil
	})
}
func rejectBackendEnvironment() error {
	for _, env := range os.Environ() {
		if strings.HasPrefix(env, "WOODPECKER_") {
			return errors.New("operator runner refuses ambient Woodpecker overrides")
		}
	}
	return nil
}
