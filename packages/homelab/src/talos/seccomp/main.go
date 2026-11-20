// Generate the reviewed Talos patch from containerd's unmodified Linux baseline.
// Build GOOS=linux GOARCH=amd64 CGO_ENABLED=0, then execute on Linux amd64.
// Required version arguments are observed runtime versions, never defaults.
package main

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"runtime/debug"
	"strings"

	seccomp "github.com/containerd/containerd/v2/contrib/seccomp"
	specs "github.com/opencontainers/runtime-spec/specs-go"
)

//go:embed promotion-policy.json
var policyJSON []byte

// policies is the reviewed provenance for every profile the node carries.
// Selected names the one the promotion chart references; the generator emits
// exactly the profile named by --profile-name.
type policies struct {
	Selected string   `json:"selected"`
	Profiles []policy `json:"profiles"`
}

type policy struct {
	ProfileName       string               `json:"profileName"`
	Patch             string               `json:"patch"`
	Architecture      string               `json:"architecture"`
	TalosVersion      string               `json:"talosVersion"`
	ContainerdVersion string               `json:"containerdVersion"`
	CodexVersion      string               `json:"codexVersion"`
	BubblewrapVersion string               `json:"bubblewrapVersion"`
	BaselineSHA256    string               `json:"baselineSha256"`
	Capabilities      []string             `json:"capabilities"`
	Delta             []specs.LinuxSyscall `json:"delta"`
}

func generate() error {
	var all policies
	decoder := json.NewDecoder(bytes.NewReader(policyJSON))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&all); err != nil {
		return err
	}
	profileName := flag.String("profile-name", "", "required reviewed profile name to generate")
	observed := map[string]*string{}
	for _, name := range []string{"talos", "containerd", "codex", "bubblewrap"} {
		observed[name] = flag.String(name+"-version", "", "required observed runtime version (without v prefix)")
	}
	codexCLI := flag.String("codex-cli", "", "required installed Codex JavaScript entrypoint in the inspected worker image")
	flag.Parse()
	if flag.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments")
	}
	var p policy
	matches := 0
	for _, candidate := range all.Profiles {
		if candidate.ProfileName == *profileName {
			p = candidate
			matches++
		}
	}
	if matches != 1 {
		return fmt.Errorf("--profile-name %q must name exactly one reviewed profile", *profileName)
	}
	expected := map[string]string{"talos": p.TalosVersion, "containerd": p.ContainerdVersion, "codex": p.CodexVersion, "bubblewrap": p.BubblewrapVersion}
	for name, version := range expected {
		if *observed[name] != version {
			return fmt.Errorf("%s runtime version %q differs from reviewed %q; review and regenerate policy", name, *observed[name], version)
		}
	}
	if runtime.GOOS != "linux" || runtime.GOARCH != p.Architecture {
		return fmt.Errorf("requires Linux/%s; got %s/%s", p.Architecture, runtime.GOOS, runtime.GOARCH)
	}
	if *codexCLI == "" {
		return fmt.Errorf("requires --codex-cli for inspecting the actual worker image")
	}
	for _, probe := range []struct {
		command []string
		version string
	}{
		{[]string{"bwrap", "--version"}, "bubblewrap " + p.BubblewrapVersion},
		{[]string{"/usr/local/bin/bun", *codexCLI, "--version"}, "codex-cli " + p.CodexVersion},
	} {
		output, err := exec.Command(probe.command[0], probe.command[1:]...).Output()
		if err != nil {
			return fmt.Errorf("runtime version probe %s failed: %w", probe.command[0], err)
		}
		if strings.TrimSpace(string(output)) != probe.version {
			return fmt.Errorf("runtime version probe returned %q; expected %q", strings.TrimSpace(string(output)), probe.version)
		}
	}
	build, ok := debug.ReadBuildInfo()
	if !ok {
		return fmt.Errorf("missing Go dependency provenance")
	}
	found := false
	for _, dep := range build.Deps {
		if dep.Path == "github.com/containerd/containerd/v2" {
			found = dep.Replace == nil && dep.Version == "v"+p.ContainerdVersion
		}
	}
	if !found {
		return fmt.Errorf("containerd generator dependency differs from reviewed version")
	}
	profile := seccomp.DefaultProfile(&specs.Spec{Process: &specs.Process{Capabilities: &specs.LinuxCapabilities{Bounding: p.Capabilities}}})
	baseline, err := json.Marshal(profile)
	if err != nil {
		return err
	}
	if fmt.Sprintf("%x", sha256.Sum256(baseline)) != p.BaselineSHA256 {
		return fmt.Errorf("containerd baseline differs from reviewed hash; inspect architecture, kernel and capabilities")
	}
	profile.Syscalls = append(profile.Syscalls, p.Delta...)
	encoded, err := json.MarshalIndent(profile, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println("# Generated from seccomp/promotion-policy.json and the pinned upstream Go module.")
	fmt.Println("# Install/read back this node prerequisite BEFORE promotion workload opt-in.")
	fmt.Printf("# Reviewed Talos %s, containerd %s, Codex %s, installed system Bubblewrap %s; Linux/%s.\n", p.TalosVersion, p.ContainerdVersion, p.CodexVersion, p.BubblewrapVersion, p.Architecture)
	fmt.Printf("machine:\n  seccompProfiles:\n    - name: %s\n      value:\n", p.ProfileName)
	for _, line := range strings.Split(string(encoded), "\n") {
		fmt.Println("        " + line)
	}
	return nil
}

func main() {
	if err := generate(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
