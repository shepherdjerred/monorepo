import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Chezmoi templates are Go text/templates, while the Linux CI image pins `go`
// in .mise.toml rather than `chezmoi`. Compile a minimal Go text/template
// harness with the exact Chezmoi template functions private_dot_kube/config.tmpl
// calls so laptop and Linux CI run the identical template evaluation path.
const goRendererSource = String.raw`package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"
)

func main() {
	if len(os.Args) != 2 {
		os.Stderr.WriteString("usage: render <json-data>\n")
		os.Exit(2)
	}
	var data map[string]any
	if err := json.Unmarshal([]byte(os.Args[1]), &data); err != nil {
		os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
	source, err := io.ReadAll(os.Stdin)
	if err != nil {
		os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
	tmpl, err := template.New("config.tmpl").Option("missingkey=error").Funcs(template.FuncMap{
		"contains": func(substr, s string) bool {
			return strings.Contains(s, substr)
		},
		"joinPath": func(elem ...string) string {
			return filepath.Join(elem...)
		},
		"onepasswordRead": func(ref string) string {
			return "op-desktop:" + filepath.Base(ref)
		},
		"output": func(name string, args ...string) (string, error) {
			cmd := exec.Command(name, args...)
			cmd.Stderr = os.Stderr
			out, err := cmd.Output()
			if err != nil {
				return "", err
			}
			return string(out), nil
		},
		"stat": func(name string) (any, error) {
			info, err := os.Stat(name)
			if err != nil {
				if errors.Is(err, os.ErrNotExist) {
					return nil, nil
				}
				return nil, err
			}
			return map[string]any{"name": info.Name()}, nil
		},
		"trim": strings.TrimSpace,
	}).Parse(string(source))
	if err != nil {
		os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
	if err := tmpl.Execute(os.Stdout, data); err != nil {
		os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
}
`;

const temporaryDirectories: string[] = [];
const templatePath = path.resolve(
  import.meta.dir,
  "../private_dot_kube/config.tmpl",
);
let rendererDirectory = "";
let rendererBinary = "";

function resolveGoExecutable(): string {
  const fromPath = Bun.which("go");
  if (fromPath !== null) {
    return fromPath;
  }
  const fromMise = Bun.spawnSync(["mise", "which", "go"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (fromMise.exitCode === 0) {
    const candidate = new TextDecoder().decode(fromMise.stdout).trim();
    if (candidate.length > 0) {
      return candidate;
    }
  }
  throw new Error("go executable not found in PATH or mise");
}

beforeAll(async () => {
  rendererDirectory = await mkdtemp(
    path.join(tmpdir(), "kube-config-renderer-"),
  );
  rendererBinary = path.join(rendererDirectory, "render");
  await Bun.write(
    path.join(rendererDirectory, "go.mod"),
    "module kubeconfigtmpltest\n\ngo 1.24\n",
  );
  await Bun.write(path.join(rendererDirectory, "main.go"), goRendererSource);
  const build = Bun.spawnSync(
    [resolveGoExecutable(), "build", "-o", rendererBinary, "main.go"],
    {
      cwd: rendererDirectory,
      env: {
        ...Bun.env,
        GOCACHE: Bun.env["GOCACHE"] ?? path.join(rendererDirectory, "gocache"),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (build.exitCode !== 0) {
    throw new Error(
      `Failed to build Go template harness: ${new TextDecoder().decode(build.stderr)}`,
    );
  }
});

afterAll(async () => {
  if (rendererDirectory.length > 0) {
    await rm(rendererDirectory, { recursive: true, force: true });
  }
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function renderKubeconfig(options: {
  profile: "agent-host" | "workstation";
  toolkitMode?: "absent" | "legacy" | "brokered";
}) {
  const root = await mkdtemp(path.join(tmpdir(), "kube-config-tmpl-"));
  temporaryDirectories.push(root);
  const home = path.join(root, "home");
  const repoRoot = path.join(root, "repo");
  const sourceDirectory = path.join(repoRoot, "packages/dotfiles");
  const wrapperDirectory = path.join(repoRoot, "scripts/onepassword");
  const localBin = path.join(home, ".local/bin");
  const callsFile = path.join(root, "calls.log");

  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(wrapperDirectory, { recursive: true });
  await mkdir(localBin, { recursive: true });
  await Bun.write(callsFile, "");

  const wrapper = path.join(wrapperDirectory, "with-service-account.sh");
  await Bun.write(
    wrapper,
    `#!/bin/bash\nset -eu\nprintf 'wrapper %s\\n' "$*" >> "$TEST_CALLS"\nprintf 'ca-from-wrapper\\n'\n`,
  );
  await chmod(wrapper, 0o700);

  const toolkitMode = options.toolkitMode ?? "absent";
  if (toolkitMode !== "absent") {
    const references =
      toolkitMode === "brokered"
        ? '[{"name":"KUBE_CERTIFICATE_AUTHORITY_DATA","ref":"op://v/i/ca","source":"registry"}]'
        : '[{"name":"ARGOCD_AUTH_TOKEN","ref":"op://v/i/t","source":"registry"}]';
    const toolkit = path.join(localBin, "toolkit");
    await Bun.write(
      toolkit,
      `#!/bin/bash\nset -eu\nprintf 'toolkit %s\\n' "$*" >> "$TEST_CALLS"\nif [[ "$1 $2" == "credentials references" ]]; then\n  printf '%s\\n' '${references}'\n  exit 0\nfi\nprintf 'ca-from-toolkit\\n'\n`,
    );
    await chmod(toolkit, 0o700);
  }

  const template = await Bun.file(templatePath).text();
  const result = Bun.spawnSync(
    [
      rendererBinary,
      JSON.stringify({
        profile: options.profile,
        chezmoi: { homeDir: home, sourceDir: sourceDirectory },
      }),
    ],
    {
      stdin: new TextEncoder().encode(template),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...Bun.env, HOME: home, TEST_CALLS: callsFile },
    },
  );

  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    calls: await Bun.file(callsFile).text(),
  };
}

test("uses the installed toolkit broker when KUBE_CERTIFICATE_AUTHORITY_DATA is registered", async () => {
  const result = await renderKubeconfig({
    profile: "agent-host",
    toolkitMode: "brokered",
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(
    "certificate-authority-data: ca-from-toolkit",
  );
  expect(result.stdout).not.toContain("client-key-data");
  expect(result.calls).toContain(
    "toolkit run --env KUBE_CERTIFICATE_AUTHORITY_DATA -- /usr/bin/printenv KUBE_CERTIFICATE_AUTHORITY_DATA\n",
  );
  expect(result.calls).not.toContain("wrapper");
});

test.each(["legacy", "absent"] as const)(
  "falls back to with-service-account.sh when toolkit is %s",
  async (toolkitMode) => {
    const result = await renderKubeconfig({
      profile: "agent-host",
      toolkitMode,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "certificate-authority-data: ca-from-wrapper",
    );
    expect(result.calls).toContain("wrapper op read ");
  },
);

test("renders workstation client certificates via onepasswordRead without exec auth", async () => {
  const result = await renderKubeconfig({ profile: "workstation" });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(
    "certificate-authority-data: op-desktop:certificate-authority-data",
  );
  expect(result.stdout).toContain(
    "client-certificate-data: op-desktop:client-certificate-data",
  );
  expect(result.stdout).toContain(
    "client-key-data: op-desktop:client-key-data",
  );
  expect(result.stdout).not.toContain("interactiveMode: Never");
  expect(result.calls).toBe("");
});
