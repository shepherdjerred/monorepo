import { afterEach, expect, test } from "vitest";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryDirectories: string[] = [];
const templatePath = path.resolve(
  import.meta.dir,
  "../private_dot_kube/config.tmpl",
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function renderAgentHostKubeconfig(
  toolkitMode: "absent" | "legacy" | "brokered",
) {
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
      "chezmoi",
      "execute-template",
      "--source",
      sourceDirectory,
      "--destination",
      home,
      "--override-data",
      JSON.stringify({
        profile: "agent-host",
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
  const result = await renderAgentHostKubeconfig("brokered");
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
  async (mode) => {
    const result = await renderAgentHostKubeconfig(mode);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "certificate-authority-data: ca-from-wrapper",
    );
    expect(result.calls).toContain("wrapper op read ");
  },
);
