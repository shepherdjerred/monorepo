import path from "node:path";
import { lstat, mkdir, realpath, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createAnimationSingleFlight } from "./animation-single-flight.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import {
  archivedAnimationFormat,
  completeActorAnimationCatalog,
} from "./archived-animation-format.mjs";

const shaPattern = /^[a-f\d]{64}$/;
export function verifyNativeAnimationExport({
  report,
  clipBytes,
  sourceSha256,
  rigSha256,
  sourceFiles,
  runtimeFingerprint,
}) {
  const native = report.nativeClip;
  if (
    report.schema !== 1 ||
    report.kind !== "original-archived-compressed-animation-probe" ||
    report.build !== "16.21.829.8620" ||
    report.boundary !== null ||
    report.sourceSha256 !== sourceSha256 ||
    report.rigSha256 !== rigSha256 ||
    report.scope?.originalResourceConstructor !== true ||
    report.scope?.originalRigBinding !== true ||
    report.scope?.originalCacheConstructor !== true ||
    report.scope?.originalEvaluator !== true ||
    report.scope?.nativeFidelityAdmission !== false ||
    !native ||
    native.sha256 !== sha(clipBytes) ||
    !shaPattern.test(native.sha256) ||
    native.frames !== report.resourceFrames ||
    native.fps !== report.resourceFps ||
    !Number.isSafeInteger(native.frames) ||
    native.frames < 1 ||
    !Number.isFinite(native.fps) ||
    native.fps <= 0 ||
    !Number.isFinite(native.duration) ||
    native.duration < 0 ||
    report.samples?.length !== native.frames + 2 ||
    !report.originalBlocks?.length ||
    !report.sources ||
    !Object.keys(report.sources).length
  )
    throw Error("Incomplete or mismatched original-native animation export");
  if (
    runtimeFingerprint !== undefined &&
    report.runtime?.fingerprint !== runtimeFingerprint
  )
    throw Error("Native animation evaluator runtime differs");
  for (const [file, digest] of Object.entries(report.sources))
    if (!shaPattern.test(digest) || sourceFiles[file] !== digest)
      throw Error(`Native animation source changed: ${file}`);
  if (
    report.samples.some((sample) => sample.finite !== true) ||
    report.samples[0].localPosesHex !==
      report.samples[native.frames].localPosesHex
  )
    throw Error("Original-native animation rewind or finite pose proof failed");
  if (clipBytes.byteLength < 4) throw Error("Truncated native animation clip");
  const headerLength = new DataView(
    clipBytes.buffer,
    clipBytes.byteOffset,
    clipBytes.byteLength,
  ).getUint32(0, true);
  if (headerLength > clipBytes.byteLength - 4)
    throw Error("Truncated native animation header");
  const header = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      clipBytes.subarray(4, 4 + headerLength),
    ),
  );
  if (
    header.schema !== 1 ||
    header.frames !== native.frames ||
    header.fps !== native.fps ||
    header.duration !== native.duration ||
    !Array.isArray(header.tracks) ||
    header.tracks.length !== native.tracks
  )
    throw Error("Native animation clip header differs from evaluator output");
  return {
    evaluator: "original-native-compressed-v1",
    frames: native.frames,
    fps: native.fps,
    duration: native.duration,
    sha256: native.sha256,
  };
}

async function run(command, label) {
  const child = Bun.spawn(command, {
    cwd: tmpdir(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw Error(`${label} failed (${code}): ${stdout}\n${stderr}`);
  return stdout;
}

// One builder per isolated preparation; cache identity is the exact resource,
// exact rig, original client/image, interpreter and conservative Python source
// closure. Nothing is selected by catching an external converter's failure.
export async function createArchivedAnimationExporter({
  sourceCache,
  cache,
  work,
  dotnet,
  python = path.join(sourceCache, "research/venv/Scripts/python.exe"),
}) {
  const tools = path.dirname(fileURLToPath(import.meta.url));
  const build = path.join(work, "animation-pack-build");
  await mkdir(build);
  for (const file of ["Program.cs", "AnimationPack.csproj"])
    await Bun.write(
      path.join(build, file),
      await Bun.file(
        new URL(`animation-pack/${file}`, import.meta.url),
      ).bytes(),
    );
  await run(
    [
      dotnet,
      "build",
      path.join(build, "AnimationPack.csproj"),
      `-p:ExporterDirectory=${path.join(sourceCache, "exporter-build/bin/Debug/net10.0")}`,
      "--ignore-failed-sources",
      "-v",
      "quiet",
    ],
    "Read-only referenced animation exporter build",
  );
  const binary = path.join(build, "bin/Debug/net10.0/AnimationPack.dll"),
    nativePackage = path.join(sourceCache, "public/decoder-16.21-macos"),
    client = path.join(sourceCache, "research/LeagueofLegends-macos"),
    probe = path.join(tools, "probe-archived-animation-native.py"),
    cacheRoot = path.join(cache, "native-animation-v1");
  await mkdir(cacheRoot, { recursive: true });
  if (
    !(await realpath(cacheRoot)).startsWith((await realpath(cache)) + path.sep)
  )
    throw Error("Native animation cache escaped approved output root");
  const sources = {},
    pending = [probe];
  while (pending.length) {
    const absolute = pending.pop();
    if (Object.hasOwn(sources, absolute)) continue;
    const bytes = await Bun.file(absolute).bytes();
    sources[absolute] = sha(bytes);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    for (const match of text.matchAll(/^\s*(?:from|import)\s+(\w+)\b/gm)) {
      const dependency = path.join(tools, `${match[1]}.py`);
      if (
        !Object.hasOwn(sources, dependency) &&
        (await Bun.file(dependency).exists())
      )
        pending.push(dependency);
    }
  }
  for (const file of [
    "animation-pack/Program.cs",
    "animation-pack/AnimationPack.csproj",
    "archived-animation-export.mjs",
    "archived-animation-format.mjs",
    "animation-single-flight.mjs",
  ]) {
    const absolute = path.resolve(tools, file);
    sources[absolute] = sha(await Bun.file(absolute).bytes());
  }
  const exporterDirectory = path.join(
    sourceCache,
    "exporter-build/bin/Debug/net10.0",
  );
  const runtimeFiles = [
    Bun.which(python) ?? python,
    Bun.which(dotnet) ?? dotnet,
    client,
    path.join(nativePackage, "image.bin"),
    path.join(nativePackage, "profile.json"),
    ...[
      ...new Bun.Glob("*.dll").scanSync({
        cwd: exporterDirectory,
        onlyFiles: true,
      }),
    ].map((file) => path.join(exporterDirectory, file)),
  ];
  const runtime = Object.fromEntries(
    await Promise.all(
      runtimeFiles.map(async (file) => [
        file,
        sha(await Bun.file(file).bytes()),
      ]),
    ),
  );
  const nativeRuntime = JSON.parse(
    await run(
      [python, path.join(tools, "animation_runtime_identity.py")],
      "Native animation runtime identification",
    ),
  );
  for (const [file, digest] of Object.entries(nativeRuntime.files))
    runtime[file] = digest;
  const contextSha256 = sha(
    new TextEncoder().encode(
      JSON.stringify({ schema: 1, sources, runtime, nativeRuntime }),
    ),
  );
  async function unchanged() {
    for (const [file, digest] of Object.entries({ ...sources, ...runtime }))
      if (sha(await Bun.file(file).bytes()) !== digest)
        throw Error(
          `Native animation implementation changed during preparation: ${file}`,
        );
  }
  return async function exportActor(folder) {
    const staging = path.join(
        work,
        `animation-${sha(new TextEncoder().encode(folder)).slice(0, 24)}`,
      ),
      clips = path.join(staging, "clips"),
      planFile = path.join(staging, "plan.json");
    await mkdir(clips, { recursive: true });
    await run(
      [dotnet, binary, folder, clips, planFile],
      "Declared-format animation preparation",
    );
    const plan = await Bun.file(planFile).json(),
      completed = new Map(),
      receipts = new Map(),
      singleFlight = createAnimationSingleFlight();
    if (
      sha(await Bun.file(path.join(folder, "model.skl")).bytes()) !==
      plan.rigSha256
    )
      throw Error("Original rig changed during animation preparation");
    // At most two original kernels run concurrently. Each resource receives a
    // fresh original rig, constructor, initialized math context and cache.
    let cursor = 0,
      failed;
    async function worker() {
      for (;;) {
        if (failed) return;
        const record = plan.records[cursor++];
        if (!record) return;
        const sourceBytes = await Bun.file(
          path.join(folder, record.file),
        ).bytes();
        if (
          sha(sourceBytes) !== record.sourceSha256 ||
          archivedAnimationFormat(sourceBytes).evaluator !== record.evaluator
        )
          throw Error("Original animation plan/source format differs");
        const clip = path.join(clips, path.basename(record.outputFile));
        if (record.evaluator === "pinned-toolkit-uncompressed") {
          completed.set(record.sourceSha256, {
            ...record,
            sha256: sha(await Bun.file(clip).bytes()),
          });
          continue;
        }
        const key = sha(
            new TextEncoder().encode(
              JSON.stringify({
                contextSha256,
                sourceSha256: record.sourceSha256,
                rigSha256: plan.rigSha256,
                rigJoints: plan.rigJoints,
              }),
            ),
          ),
          target = path.join(cacheRoot, key),
          receiptFile = path.join(target, "receipt.json");
        const exported = await singleFlight(key, async () => {
          const existing = await lstat(target).catch((error) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          });
          if (existing && !(await Bun.file(receiptFile).exists()))
            throw Error("Incomplete original-native animation cache entry");
          if (await Bun.file(receiptFile).exists()) {
            if (
              !(await realpath(target)).startsWith(
                (await realpath(cacheRoot)) + path.sep,
              )
            )
              throw Error("Native animation cache entry escaped cache root");
            const receipt = await Bun.file(receiptFile).json();
            if (receipt.key !== key || receipt.contextSha256 !== contextSha256)
              throw Error("Native animation cache identity differs");
            const reportBytes = await Bun.file(
                path.join(target, "report.json"),
              ).bytes(),
              clipBytes = await Bun.file(
                path.join(target, "resource.clip"),
              ).bytes();
            if (
              sha(reportBytes) !== receipt.reportSha256 ||
              sha(clipBytes) !== receipt.clipSha256
            )
              throw Error("Corrupt original-native animation cache receipt");
            const resource = verifyNativeAnimationExport({
              report: JSON.parse(new TextDecoder().decode(reportBytes)),
              clipBytes,
              sourceSha256: record.sourceSha256,
              rigSha256: plan.rigSha256,
              sourceFiles: sources,
              runtimeFingerprint: nativeRuntime.fingerprint,
            });
            return { resource, clipBytes, receipt };
          }
          const stage = path.join(staging, key);
          await mkdir(stage);
          const reportFile = path.join(stage, "report.json"),
            nativeClip = path.join(stage, "resource.clip");
          console.log(
            JSON.stringify({
              originalNativeAnimation: record.file,
              resourceSha256: record.sourceSha256,
              status: "exporting",
            }),
          );
          await run(
            [
              python,
              probe,
              nativePackage,
              client,
              folder,
              planFile,
              reportFile,
              "--source",
              record.file,
              "--all-frames",
              "--clip-output",
              nativeClip,
            ],
            "Original-native compressed-v1 animation export",
          );
          const reportBytes = await Bun.file(reportFile).bytes(),
            clipBytes = await Bun.file(nativeClip).bytes();
          const resource = verifyNativeAnimationExport({
            report: JSON.parse(new TextDecoder().decode(reportBytes)),
            clipBytes,
            sourceSha256: record.sourceSha256,
            rigSha256: plan.rigSha256,
            sourceFiles: sources,
            runtimeFingerprint: nativeRuntime.fingerprint,
          });
          await unchanged();
          const receipt = {
            schema: 1,
            key,
            contextSha256,
            sourceSha256: record.sourceSha256,
            rigSha256: plan.rigSha256,
            reportSha256: sha(reportBytes),
            clipSha256: sha(clipBytes),
            resource,
          };
          await Bun.write(
            path.join(stage, "receipt.json"),
            JSON.stringify(receipt),
          );
          await rename(stage, target);
          return { resource, clipBytes, receipt };
        });
        completed.set(record.sourceSha256, exported.resource);
        await Bun.write(clip, exported.clipBytes);
        receipts.set(key, exported.receipt);
      }
    }
    await Promise.all(
      [worker(), worker()].map(async (running) => {
        try {
          await running;
        } catch (error) {
          failed ??= error;
        }
      }),
    );
    if (failed) throw failed;
    await unchanged();
    const catalog = completeActorAnimationCatalog(plan, completed);
    await mkdir(path.join(folder, "clips"), { recursive: true });
    for (const record of plan.records)
      await Bun.write(
        path.join(folder, record.outputFile),
        await Bun.file(
          path.join(clips, path.basename(record.outputFile)),
        ).bytes(),
      );
    await Bun.write(
      path.join(folder, "animation-evidence.json"),
      JSON.stringify({
        schema: 1,
        contextSha256,
        sources,
        runtime,
        records: plan.records,
        nativeExports: [...receipts.values()],
        nativeFidelityAdmission: false,
      }),
    );
    await Bun.write(
      path.join(folder, "animation-catalog.json"),
      JSON.stringify(catalog),
    );
    return {
      contextSha256,
      nativeExports: receipts.size,
      resources: plan.records.length,
    };
  };
}
