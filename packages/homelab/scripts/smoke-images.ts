#!/usr/bin/env bun
/**
 * Smoke tests for the homelab infra images.
 *
 * Boots each freshly-built `<name>:dev` image and asserts on startup behavior,
 * translating the old Dagger smoke tests (smokeTestCaddyS3Proxy,
 * smokeTestObsidianHeadless, smokeTestMcpGateway, plus a redlib boot check) into
 * a dependency-free Bun script.
 *
 * Each check runs a container via `docker run`, inspects stdout/stderr/exit code,
 * and always tears the container down with `docker rm -f`. Any failure prints a
 * clear per-image FAIL and the whole script exits non-zero.
 *
 * Run after `bun run docker:build` (turbo wires `smoke` dependsOn `docker:build`).
 */

type SmokeResult = { image: string; ok: boolean; detail: string };

/** Run a command to completion, capturing stdout/stderr and the exit code. */
async function run(
  cmd: string[],
  opts: { timeoutMs?: number; stdin?: Blob } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const proc = Bun.spawn(cmd, {
    stdin: opts.stdin,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
      }, opts.timeoutMs)
    : undefined;

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (timer) clearTimeout(timer);

  return { stdout, stderr, exitCode: timedOut ? 124 : exitCode };
}

/** Force-remove a container by name, ignoring "no such container". */
async function forceRemove(name: string): Promise<void> {
  await run(["docker", "rm", "-f", name]);
}

/**
 * Smoke test caddy-s3proxy.
 * Verifies: the custom Caddy binary reports its version, the s3proxy module is
 * compiled in, and the freshly built binary accepts the generated production
 * Caddyfile (including every s3proxy/reverse-proxy directive).
 */
async function smokeCaddyS3Proxy(): Promise<SmokeResult> {
  const image = "caddy-s3proxy:dev";
  const name = "smoke-caddy-s3proxy";
  await forceRemove(name);
  try {
    let caddyfile: Blob;
    const providedCaddyfile = process.env["CADDYFILE_SMOKE_PATH"];
    if (providedCaddyfile === undefined) {
      // Local smoke runs have cdk8s dependencies installed, so generate the
      // same config inline. CI passes verify's artifact to keep this image lane
      // free of a workspace install.
      const generator = new URL(
        "../src/cdk8s/scripts/generate-caddyfile.ts",
        import.meta.url,
      ).pathname;
      const generated = await run(["bun", "--no-install", "run", generator]);
      if (generated.exitCode !== 0) {
        return {
          image,
          ok: false,
          detail: `Caddyfile generation failed (exit ${String(generated.exitCode)})\n${generated.stderr}`,
        };
      }
      caddyfile = new Blob([generated.stdout]);
    } else {
      const provided = Bun.file(providedCaddyfile);
      if (!(await provided.exists())) {
        return {
          image,
          ok: false,
          detail: `generated Caddyfile artifact is missing: ${providedCaddyfile}`,
        };
      }
      caddyfile = provided;
    }

    const version = await run([
      "docker",
      "run",
      "--rm",
      "--name",
      name,
      "--entrypoint",
      "caddy",
      image,
      "version",
    ]);
    if (version.exitCode !== 0) {
      return {
        image,
        ok: false,
        detail: `caddy version exited ${String(version.exitCode)}\n${version.stderr}`,
      };
    }

    const modules = await run([
      "docker",
      "run",
      "--rm",
      "--name",
      `${name}-mod`,
      "--entrypoint",
      "caddy",
      image,
      "list-modules",
    ]);
    if (!modules.stdout.includes("s3proxy")) {
      return {
        image,
        ok: false,
        detail: `s3proxy module missing from \`caddy list-modules\`\n${modules.stdout}\n${modules.stderr}`,
      };
    }

    // Stream the real generated config: the dind daemon cannot bind-mount a
    // path from the Buildkite command container.
    const validate = await run(
      [
        "docker",
        "run",
        "--rm",
        "-i",
        "--name",
        `${name}-val`,
        "--entrypoint",
        "sh",
        image,
        "-c",
        "cat > /tmp/Caddyfile && caddy validate --config /tmp/Caddyfile --adapter caddyfile",
      ],
      { stdin: caddyfile },
    );
    if (validate.exitCode !== 0) {
      return {
        image,
        ok: false,
        detail: `caddy validate failed (exit ${String(validate.exitCode)})\n${validate.stdout}\n${validate.stderr}`,
      };
    }

    return {
      image,
      ok: true,
      detail: `version=${version.stdout.trim()}; s3proxy module present; generated production config validates`,
    };
  } finally {
    await forceRemove(name);
    await forceRemove(`${name}-mod`);
    await forceRemove(`${name}-val`);
  }
}

/**
 * Smoke test obsidian-headless.
 * Verifies: the `ob` CLI is installed and `--help` runs, and the better-sqlite3
 * native addon loads AND round-trips a row (from obsidian-headless's install dir
 * so require() resolves the same way the CLI does at runtime).
 */
async function smokeObsidianHeadless(): Promise<SmokeResult> {
  const image = "obsidian-headless:dev";
  const name = "smoke-obsidian-headless";
  await forceRemove(name);
  try {
    const help = await run([
      "docker",
      "run",
      "--rm",
      "--name",
      name,
      "--entrypoint",
      "ob",
      image,
      "--help",
    ]);
    if (help.exitCode !== 0) {
      return {
        image,
        ok: false,
        detail: `ob --help exited ${String(help.exitCode)}\n${help.stderr}`,
      };
    }

    // Installed version matches the pin baked into the image. Catches the "stale
    // cached image serving an outdated ob" failure mode: the Dockerfile installs
    // OBSIDIAN_HEADLESS_EXPECTED_VERSION, so `ob --version` must equal it.
    const version = await run([
      "docker",
      "run",
      "--rm",
      "--name",
      `${name}-version`,
      "--entrypoint",
      "sh",
      image,
      "-c",
      'actual="$(ob --version)"; ' +
        'if [ "$actual" != "$OBSIDIAN_HEADLESS_EXPECTED_VERSION" ]; then ' +
        'echo "version mismatch: installed=$actual expected=$OBSIDIAN_HEADLESS_EXPECTED_VERSION" >&2; exit 1; fi; ' +
        'echo "obsidian-headless version pinned: $actual"',
    ]);
    if (version.exitCode !== 0) {
      return {
        image,
        ok: false,
        detail: `version pin check failed (exit ${String(version.exitCode)})\n${version.stdout}\n${version.stderr}`,
      };
    }

    // better-sqlite3 native addon loads and round-trips a row.
    const sqlite = await run([
      "docker",
      "run",
      "--rm",
      "--name",
      `${name}-sqlite`,
      "--entrypoint",
      "sh",
      image,
      "-c",
      [
        'cd "$(npm root -g)/obsidian-headless"',
        "node -e \"const Database = require('better-sqlite3');" +
          " const db = new Database(':memory:');" +
          " db.exec('CREATE TABLE t (x INT)');" +
          " db.prepare('INSERT INTO t VALUES (?)').run(42);" +
          " if (db.prepare('SELECT x FROM t').get().x !== 42)" +
          " throw new Error('better-sqlite3 round-trip failed');" +
          " console.log('better-sqlite3 OK');\"",
      ].join(" && "),
    ]);
    if (sqlite.exitCode !== 0 || !sqlite.stdout.includes("better-sqlite3 OK")) {
      return {
        image,
        ok: false,
        detail: `better-sqlite3 check failed (exit ${String(sqlite.exitCode)})\n${sqlite.stdout}\n${sqlite.stderr}`,
      };
    }

    return {
      image,
      ok: true,
      detail: `ob --help OK; ${version.stdout.trim()}; better-sqlite3 native addon round-trips`,
    };
  } finally {
    await forceRemove(name);
    await forceRemove(`${name}-version`);
    await forceRemove(`${name}-sqlite`);
  }
}

/**
 * Smoke test mcp-gateway.
 * Verifies: the Node runtime is present, the prebuilt edstem-mcp entrypoint
 * exists and parses (`node --check`), and every production dependency survived
 * `npm prune --omit=dev`.
 */
async function smokeMcpGateway(): Promise<SmokeResult> {
  const image = "mcp-gateway:dev";
  const name = "smoke-mcp-gateway";
  await forceRemove(name);
  try {
    const node = await run([
      "docker",
      "run",
      "--rm",
      "--name",
      name,
      "--entrypoint",
      "node",
      image,
      "--version",
    ]);
    if (node.exitCode !== 0) {
      return {
        image,
        ok: false,
        detail: `node --version exited ${String(node.exitCode)}\n${node.stderr}`,
      };
    }

    // Entrypoint exists and parses.
    const check = await run([
      "docker",
      "run",
      "--rm",
      "--name",
      `${name}-check`,
      "--entrypoint",
      "sh",
      image,
      "-c",
      "test -f /opt/edstem-mcp/dist/index.js && node --check /opt/edstem-mcp/dist/index.js && echo 'edstem-mcp entrypoint OK'",
    ]);
    if (
      check.exitCode !== 0 ||
      !check.stdout.includes("edstem-mcp entrypoint OK")
    ) {
      return {
        image,
        ok: false,
        detail: `edstem-mcp entrypoint check failed (exit ${String(check.exitCode)})\n${check.stdout}\n${check.stderr}`,
      };
    }

    // Every prod dependency survived `npm prune --omit=dev`. `node --check` only
    // parses the entry; it never exercises the import graph, so a prod dep
    // misclassified as a devDependency upstream would pass syntax checks yet crash
    // on first real invocation. edstem-mcp is ESM, so verify dep presence directly.
    const deps = await run([
      "docker",
      "run",
      "--rm",
      "--name",
      `${name}-deps`,
      "--entrypoint",
      "node",
      image,
      "--input-type=module",
      "-e",
      [
        "import { readFileSync, existsSync } from 'node:fs';",
        "const pkg = JSON.parse(readFileSync('/opt/edstem-mcp/package.json', 'utf8'));",
        "const deps = Object.keys(pkg.dependencies ?? {});",
        "const missing = deps.filter((d) => !existsSync(`/opt/edstem-mcp/node_modules/${d}`));",
        "if (missing.length) { console.error('missing prod deps after prune:', missing); process.exit(1); }",
        "console.log(`all ${deps.length} prod deps present after prune`);",
      ].join("\n"),
    ]);
    if (deps.exitCode !== 0) {
      return {
        image,
        ok: false,
        detail: `prod-dep presence check failed (exit ${String(deps.exitCode)})\n${deps.stdout}\n${deps.stderr}`,
      };
    }

    return {
      image,
      ok: true,
      detail: `node=${node.stdout.trim()}; edstem-mcp entrypoint parses; ${deps.stdout.trim()}`,
    };
  } finally {
    await forceRemove(name);
    await forceRemove(`${name}-check`);
    await forceRemove(`${name}-deps`);
  }
}

/**
 * Smoke test redlib.
 * Verifies: the redlib binary boots, binds its HTTP port, and serves a request.
 * redlib serves an HTTP frontend; the boot check confirms the built binary runs
 * and answers on its port. Reddit OAuth may fail offline, so we assert only that
 * the server responds (any HTTP status), not on page content.
 */
async function smokeRedlib(): Promise<SmokeResult> {
  const image = "redlib:dev";
  const name = "smoke-redlib";
  const port = 18080;
  await forceRemove(name);
  try {
    // redlib listens on 8080 by default; publish it to a host port.
    const start = await run([
      "docker",
      "run",
      "-d",
      "--name",
      name,
      "-p",
      `${String(port)}:8080`,
      image,
    ]);
    if (start.exitCode !== 0) {
      return {
        image,
        ok: false,
        detail: `docker run failed (exit ${String(start.exitCode)})\n${start.stderr}`,
      };
    }

    // Poll the health endpoint until it answers or we time out.
    const deadline = Date.now() + 30_000;
    let served = false;
    let lastErr = "";
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${String(port)}/settings`, {
          signal: AbortSignal.timeout(2000),
        });
        // Any HTTP response means the server booted and is serving.
        served = res.status > 0;
        if (served) break;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
      await Bun.sleep(1000);
    }

    if (!served) {
      const logs = await run(["docker", "logs", name]);
      return {
        image,
        ok: false,
        detail: `redlib did not serve on :${String(port)} within 30s (last error: ${lastErr})\n${logs.stdout}\n${logs.stderr}`,
      };
    }

    return {
      image,
      ok: true,
      detail: `redlib booted and served on :${String(port)}`,
    };
  } finally {
    await forceRemove(name);
  }
}

/**
 * Smoke test shelfbridge.
 * Verifies: the binary boots with a minimal env (fails fast without API_KEY),
 * serves /health, and answers a Torznab caps query authenticated by the
 * configured API key — the exact endpoint Prowlarr/Bindery will hit.
 */
async function smokeShelfbridge(): Promise<SmokeResult> {
  const image = "shelfbridge:dev";
  const name = "smoke-shelfbridge";
  const port = 18787;
  const apiKey = "smoke-test-key";
  await forceRemove(name);
  try {
    const start = await run([
      "docker",
      "run",
      "-d",
      "--name",
      name,
      "-p",
      `${String(port)}:8787`,
      "-e",
      `API_KEY=${apiKey}`,
      "-e",
      "SOURCE_LIBGEN=false",
      "-e",
      "SOURCE_ANNAS=false",
      "-e",
      "SOURCE_ZLIB=false",
      image,
    ]);
    if (start.exitCode !== 0) {
      return {
        image,
        ok: false,
        detail: `docker run failed (exit ${String(start.exitCode)})\n${start.stderr}`,
      };
    }

    const deadline = Date.now() + 30_000;
    let healthy = false;
    let lastErr = "";
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${String(port)}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        healthy = res.ok;
        if (healthy) break;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
      await Bun.sleep(1000);
    }

    if (!healthy) {
      const logs = await run(["docker", "logs", name]);
      return {
        image,
        ok: false,
        detail: `shelfbridge /health did not answer on :${String(port)} within 30s (last error: ${lastErr})\n${logs.stdout}\n${logs.stderr}`,
      };
    }

    const caps = await fetch(
      `http://127.0.0.1:${String(port)}/torznab/api?t=caps&apikey=${apiKey}`,
      { signal: AbortSignal.timeout(5000) },
    );
    const capsBody = await caps.text();
    if (!caps.ok || !capsBody.includes("<caps")) {
      return {
        image,
        ok: false,
        detail: `torznab caps query failed (status ${String(caps.status)})\n${capsBody}`,
      };
    }

    return {
      image,
      ok: true,
      detail: `shelfbridge booted, /health OK, torznab caps served on :${String(port)}`,
    };
  } finally {
    await forceRemove(name);
  }
}

async function main(): Promise<void> {
  const checks: Array<{ label: string; fn: () => Promise<SmokeResult> }> = [
    { label: "caddy-s3proxy", fn: smokeCaddyS3Proxy },
    { label: "obsidian-headless", fn: smokeObsidianHeadless },
    { label: "mcp-gateway", fn: smokeMcpGateway },
    { label: "redlib", fn: smokeRedlib },
    { label: "shelfbridge", fn: smokeShelfbridge },
  ];

  const results: SmokeResult[] = [];
  // Serial on purpose — never two containers competing for the same resources.
  for (const check of checks) {
    process.stdout.write(`\n▶ smoke: ${check.label}\n`);
    const result = await check.fn();
    results.push(result);
    process.stdout.write(
      `${result.ok ? "✅ PASS" : "❌ FAIL"} ${result.image} — ${result.detail}\n`,
    );
  }

  process.stdout.write("\n─── Smoke summary ───\n");
  for (const r of results) {
    process.stdout.write(`${r.ok ? "✅" : "❌"} ${r.image}\n`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    process.stdout.write(
      `\n${String(failed.length)} image(s) failed smoke tests.\n`,
    );
    process.exit(1);
  }
  process.stdout.write("\nAll images passed smoke tests.\n");
}

await main();
