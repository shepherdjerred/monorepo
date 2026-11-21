import { chmod, mkdir, rename, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

const mediaRoot = path.resolve(import.meta.dir, "..");
const repositoryRoot = path.resolve(mediaRoot, "..", "..");
const generatedBinDir = path.join(
  mediaRoot,
  "generated",
  "native-tools",
  "bin",
);

function resolveCacheRoot(): string {
  const xdgCache = Bun.env["XDG_CACHE_HOME"]?.trim();
  const base =
    xdgCache !== undefined && xdgCache.length > 0
      ? xdgCache
      : path.join(homedir(), ".cache");
  return path.join(base, "media-native-tools");
}

function dotnetRuntimeIdentifier(): string {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "osx-arm64";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "osx-x64";
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "linux-arm64";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "linux-x64";
  }
  throw new Error(
    `Unsupported platform/arch for Media native tools: ${process.platform}/${process.arch}`,
  );
}

async function resolvePinnedDotnet(): Promise<{
  readonly executable: string;
  readonly root: string;
}> {
  const mise = Bun.which("mise") ?? "mise";
  const result = Bun.spawnSync([mise, "where", "dotnet"], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `mise where dotnet failed (${String(result.exitCode)}): ${result.stderr.toString().trim()}`,
    );
  }
  const root = result.stdout.toString().trim();
  const executable = path.join(root, "dotnet");
  if (!(await Bun.file(executable).exists())) {
    throw new Error(`Pinned .NET executable not found at ${executable}`);
  }
  return { executable, root };
}

async function resolveUvExecutable(): Promise<string> {
  const onPath = Bun.which("uv");
  if (onPath !== null) return onPath;
  for (const candidate of [
    path.join(homedir(), ".local", "bin", "uv"),
    "/root/.local/bin/uv",
  ]) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  throw new Error(
    "uv executable is required to provision Media subtitle tools",
  );
}

async function acquireAdvisoryLock(
  lockFile: string,
): Promise<() => Promise<void>> {
  const python = Bun.which("python3") ?? "/usr/bin/python3";
  const holder = Bun.spawn(
    [
      python,
      "-c",
      String.raw`import fcntl, os, sys; fd = os.open(sys.argv[1], os.O_CREAT | os.O_RDWR, 0o600); fcntl.flock(fd, fcntl.LOCK_EX); sys.stdout.write("locked\n"); sys.stdout.flush(); sys.stdin.buffer.read()`,
      lockFile,
    ],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const reader = holder.stdout.getReader();
  const chunk = await reader.read();
  reader.releaseLock();
  const text =
    chunk.value === undefined ? "" : new TextDecoder().decode(chunk.value);
  if (!text.startsWith("locked")) {
    const stderr = await new Response(holder.stderr).text();
    holder.kill("SIGKILL");
    await holder.exited;
    throw new Error(
      `Failed to acquire native tools lock ${lockFile}: ${stderr.trim()}`,
    );
  }
  return async () => {
    await holder.stdin.end();
    await holder.exited;
  };
}

async function runChecked(
  command: readonly string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<void> {
  const child = Bun.spawn([...command], {
    cwd: options.cwd ?? mediaRoot,
    env: options.env ?? Bun.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${String(exitCode)}): ${command.join(" ")}\n${stdout}\n${stderr}`.trim(),
    );
  }
}

async function atomicSymlink(
  target: string,
  destination: string,
): Promise<void> {
  const temporary = `${destination}.tmp-${crypto.randomUUID()}`;
  await rm(temporary, { force: true });
  await symlink(target, temporary);
  await rename(temporary, destination);
}

async function atomicExecutable(
  content: string,
  destination: string,
): Promise<void> {
  const temporary = `${destination}.tmp-${crypto.randomUUID()}`;
  await Bun.write(temporary, content);
  await chmod(temporary, 0o755);
  await rename(temporary, destination);
}

const RegexSmokeResponseSchema = z.object({
  protocolVersion: z.literal(1),
  engine: z.literal("dotnet-ignorecase"),
  culture: z.literal("en-US"),
  observations: z.array(z.object({ result: z.string() })),
});

function verifyRegexOracle(executable: string): void {
  const request = JSON.stringify({
    protocolVersion: 1,
    requests: [
      { pattern: "(?<=Movie[ .])2160p", value: "Movie.2160P.WEB" },
      { pattern: "(?<!HD)TV", value: "HDTV" },
      { pattern: "(", value: "invalid" },
    ],
  });
  const result = Bun.spawnSync([executable], {
    stdin: new TextEncoder().encode(request),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: Bun.env["PATH"],
      DOTNET_NOLOGO: "1",
      LANG: "en_US.UTF-8",
    },
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `RegexOracle smoke test failed (${String(result.exitCode)}): ${result.stderr.toString().trim()}`,
    );
  }
  const parsed = RegexSmokeResponseSchema.parse(
    JSON.parse(result.stdout.toString()),
  );
  const outcomes = parsed.observations.map((item) => item.result);
  if (
    outcomes.length !== 3 ||
    outcomes[0] !== "match" ||
    outcomes[1] !== "no_match" ||
    outcomes[2] !== "unknown"
  ) {
    throw new Error(
      `RegexOracle protocol mismatch: ${JSON.stringify(outcomes)}`,
    );
  }
}

async function ensureRegexOracle(cacheRoot: string): Promise<string> {
  const rid = dotnetRuntimeIdentifier();
  const dotnet = await resolvePinnedDotnet();
  const inputFiles = [
    "scripts/regex-oracle/RegexOracle.csproj",
    "scripts/regex-oracle/Program.cs",
    "scripts/regex-oracle/ProtocolValidator.cs",
    "src/migration/regex-protocol.schema.json",
  ];
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(`rid:${rid}\ndotnet:${dotnet.root}\n`);
  for (const relativePath of inputFiles) {
    hasher.update(`${relativePath}\n`);
    hasher.update(await Bun.file(path.join(mediaRoot, relativePath)).bytes());
    hasher.update("\n");
  }
  const digest = hasher.digest("hex").slice(0, 24);
  const entryDir = path.join(cacheRoot, `regex-oracle-${rid}-${digest}`);
  const publishedBinary = path.join(entryDir, "publish", "RegexOracle");
  const readyMarker = path.join(entryDir, "ready");

  if (
    !(await Bun.file(readyMarker).exists()) ||
    !(await Bun.file(publishedBinary).exists())
  ) {
    await rm(entryDir, { recursive: true, force: true });
    const stagingDir = `${entryDir}.tmp-${crypto.randomUUID()}`;
    await mkdir(stagingDir, { recursive: true });
    try {
      await runChecked(
        [
          dotnet.executable,
          "publish",
          path.join(mediaRoot, "scripts", "regex-oracle", "RegexOracle.csproj"),
          "--configuration",
          "Release",
          "--runtime",
          rid,
          "--self-contained",
          "true",
          "--artifacts-path",
          path.join(stagingDir, "build"),
          "--output",
          path.join(stagingDir, "publish"),
        ],
        {
          env: {
            ...Bun.env,
            DOTNET_ROOT: dotnet.root,
            DOTNET_MULTILEVEL_LOOKUP: "0",
            DOTNET_CLI_TELEMETRY_OPTOUT: "1",
            DOTNET_NOLOGO: "1",
            DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
          },
        },
      );
      const stagedBinary = path.join(stagingDir, "publish", "RegexOracle");
      verifyRegexOracle(stagedBinary);
      await Bun.write(path.join(stagingDir, "ready"), `${digest}\n`);
      await rename(stagingDir, entryDir);
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true });
      throw error;
    }
  }

  return publishedBinary;
}

function verifySubtitleTools(venvPython: string, ffsubsyncBin: string): void {
  const pythonCheck = Bun.spawnSync(
    [
      venvPython,
      "-c",
      'from importlib.metadata import version; import numpy, webrtcvad; assert version("ffsubsync") == "0.5.1"',
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin" },
    },
  );
  if (pythonCheck.exitCode !== 0) {
    throw new Error(
      `Subtitle Python environment verification failed: ${pythonCheck.stderr.toString().trim()}`,
    );
  }
  const ffsubsyncCheck = Bun.spawnSync([ffsubsyncBin, "--version"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin" },
  });
  if (ffsubsyncCheck.exitCode !== 0) {
    throw new Error(
      `ffsubsync verification failed: ${ffsubsyncCheck.stderr.toString().trim()}`,
    );
  }
}

async function ensureSubtitleVenv(cacheRoot: string): Promise<{
  readonly venvPython: string;
  readonly ffsubsyncBin: string;
}> {
  const uv = await resolveUvExecutable();
  const buildReq = path.join(
    mediaRoot,
    "scripts",
    "subtitle-build-requirements.txt",
  );
  const runtimeReq = path.join(
    mediaRoot,
    "scripts",
    "subtitle-requirements.txt",
  );
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(
    `v2\nplatform:${process.platform}-${process.arch}\npython:3.13\n`,
  );
  hasher.update(await Bun.file(buildReq).bytes());
  hasher.update("\n");
  hasher.update(await Bun.file(runtimeReq).bytes());
  const digest = hasher.digest("hex").slice(0, 24);
  const entryDir = path.join(
    cacheRoot,
    `subtitles-${process.platform}-${process.arch}-${digest}`,
  );
  const venvDir = path.join(entryDir, "venv");
  const venvPython = path.join(venvDir, "bin", "python");
  const ffsubsyncBin = path.join(venvDir, "bin", "ffsubsync");
  const readyMarker = path.join(entryDir, "ready");

  // Python console_scripts embed the absolute interpreter path at install time,
  // so build in place under the caller's advisory lock and seal with `ready`.
  if (
    !(await Bun.file(readyMarker).exists()) ||
    !(await Bun.file(venvPython).exists()) ||
    !(await Bun.file(ffsubsyncBin).exists())
  ) {
    await rm(entryDir, { recursive: true, force: true });
    await mkdir(entryDir, { recursive: true });
    try {
      await runChecked([uv, "venv", "--python", "3.13", venvDir]);
      await runChecked([
        uv,
        "pip",
        "install",
        "--python",
        venvPython,
        "--require-hashes",
        "--only-binary",
        ":all:",
        "-r",
        buildReq,
      ]);
      await runChecked([
        uv,
        "pip",
        "install",
        "--python",
        venvPython,
        "--require-hashes",
        "--no-build-isolation",
        "-r",
        runtimeReq,
      ]);
      verifySubtitleTools(venvPython, ffsubsyncBin);
      await Bun.write(readyMarker, `${digest}\n`);
    } catch (error) {
      await rm(entryDir, { recursive: true, force: true });
      throw error;
    }
  }

  return { venvPython, ffsubsyncBin };
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

export async function ensureMediaNativeTools(): Promise<void> {
  const cacheRoot = resolveCacheRoot();
  await mkdir(cacheRoot, { recursive: true });
  const releaseLock = await acquireAdvisoryLock(path.join(cacheRoot, ".lock"));
  try {
    const [regexBinary, subtitles] = await Promise.all([
      ensureRegexOracle(cacheRoot),
      ensureSubtitleVenv(cacheRoot),
    ]);
    const analysisScript = path.join(
      mediaRoot,
      "scripts",
      "subtitle-analysis.py",
    );
    if (!(await Bun.file(analysisScript).exists())) {
      throw new Error(`Missing subtitle analysis script at ${analysisScript}`);
    }
    await mkdir(generatedBinDir, { recursive: true });
    const linkedRegex = path.join(generatedBinDir, "RegexOracle");
    const linkedFfsubsync = path.join(generatedBinDir, "ffsubsync");
    const linkedAnalysis = path.join(
      generatedBinDir,
      "media-subtitle-analysis",
    );

    await atomicSymlink(regexBinary, linkedRegex);
    await atomicSymlink(subtitles.ffsubsyncBin, linkedFfsubsync);
    await atomicExecutable(
      `#!/bin/sh\nexec ${shellSingleQuote(subtitles.venvPython)} ${shellSingleQuote(analysisScript)} "$@"\n`,
      linkedAnalysis,
    );

    verifyRegexOracle(linkedRegex);
    verifySubtitleTools(subtitles.venvPython, linkedFfsubsync);
  } finally {
    await releaseLock();
  }
}

if (import.meta.main) {
  await ensureMediaNativeTools();
}
