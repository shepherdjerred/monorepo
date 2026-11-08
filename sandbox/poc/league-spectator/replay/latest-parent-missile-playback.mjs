// Per-match inputs stay in the browser. Each admitted simultaneous birth group
// owns an isolated native context; this is still an explicit preview RNG policy.
import { LatestParentWorkerClient } from "./latest-parent-worker-client.mjs";
import { buildParentMissileBursts } from "./latest-parent-missile-inputs.mjs";
import {
  PARENT_RUNTIME_SHA,
  PARENT_CACHES_SHA,
} from "./latest-parent-frames.mjs";
import { PARENT_MATH_SHA } from "./latest-parent-math.mjs";
import { UNICORN_BULK_PACKAGE_SHA } from "./latest-unicorn-bulk.mjs";
import { sha256 } from "./structural-comparison.mjs";

export class LatestParentMissilePlayback {
  constructor({
    assetBase,
    workerUrl,
    runtimeModuleUrl = new URL("vendor/unicorn_x86_candidate.mjs", assetBase)
      .href,
  }) {
    this.assetBase = assetBase;
    this.workerUrl = workerUrl;
    this.runtimeModuleUrl = runtimeModuleUrl;
    this.contexts = [];
    this.owners = [];
    this.gaps = [];
    this.closed = false;
    this.abort = new AbortController();
  }
  check() {
    if (this.closed)
      throw new DOMException("Parent playback closed", "AbortError");
  }
  async bytes(file, digest) {
    this.check();
    const response = await fetch(new URL(file, this.assetBase), {
      signal: this.abort.signal,
    });
    if (response.status !== 200)
      throw Error(`Parent playback asset HTTP ${response.status}: ${file}`);
    const data = new Uint8Array(await response.arrayBuffer());
    if (digest && (await sha256(data)) !== digest)
      throw Error(`Parent playback asset hash differs: ${file}`);
    this.check();
    return data;
  }
  async load(playback) {
    this.check();
    if (this.loading || this.ready || !Array.isArray(playback?.traces))
      throw Error("Explicit unloaded parent playback required");
    this.loading = true;
    try {
      const [
        profileBytes,
        abiBytes,
        cachePackageBytes,
        mathPackageBytes,
        runtimeBytes,
        bulkPackageBytes,
      ] = await Promise.all([
        this.bytes("decoder-16.21-macos/profile.json"),
        this.bytes(
          "latest-parent-frame-runtime/package.json",
          PARENT_RUNTIME_SHA,
        ),
        this.bytes(
          "latest-parent-frame-caches/package.json",
          PARENT_CACHES_SHA,
        ),
        this.bytes("latest-parent-math/package.json", PARENT_MATH_SHA),
        this.bytes(
          "vendor/unicorn_x86_candidate.mjs",
          "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
        ),
        this.bytes(
          "latest-unicorn-bulk/package.json",
          UNICORN_BULK_PACKAGE_SHA,
        ),
      ]);
      const decode = (b) =>
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b));
      const profile = decode(profileBytes),
        catalog = decode(cachePackageBytes),
        bulk = decode(bulkPackageBytes);
      if (
        profile.clientVersion !== "16.21.829.8620" ||
        profile.protocolDigest !== "20e09df23c66b85e" ||
        catalog.build !== profile.clientVersion ||
        catalog.protocol !== profile.protocolDigest
      )
        throw Error("Unsupported complete-parent playback build");
      const [image, spawnBytes, bulkWasmBytes] = await Promise.all([
        this.bytes("decoder-16.21-macos/image.bin", profile.decoderImageSha256),
        this.bytes(
          "decoder-16.21-macos/vfx-spawn.json",
          profile.vfxSpawnSha256,
        ),
        this.bytes(`latest-unicorn-bulk/${bulk.file}`, bulk.wasmSha256),
      ]);
      const cacheByEffect = new Map(catalog.caches.map((c) => [c.effectId, c])),
        admitted = [];
      const sequences = new Set();
      for (const trace of playback.traces) {
        if (
          !Number.isSafeInteger(trace.sequence) ||
          sequences.has(trace.sequence)
        )
          throw Error("Duplicate or invalid complete-parent replay sequence");
        sequences.add(trace.sequence);
        if (!cacheByEffect.has(trace.effectId))
          this.gaps.push({
            sequence: trace.sequence,
            effectId: trace.effectId,
            reason: "complete-parent-resource-cache-unprepared",
          });
        else admitted.push(trace);
      }
      const groups = admitted.length ? buildParentMissileBursts(admitted) : [];
      const common = {
        profile,
        spawnBytes,
        abiBytes,
        cachePackageBytes,
        mathPackageBytes,
        runtimeBytes,
        bulkPackageBytes,
        bulkWasmBytes,
      };
      for (const group of groups) {
        this.check();
        const client = new LatestParentWorkerClient({
          workerUrl: this.workerUrl,
        });
        const context = {
          client,
          startTime: group.startTime,
          completeAt: null,
          keys: [],
        };
        this.contexts.push(context);
        const ref = cacheByEffect.get(group.effectId),
          cacheBytes = await this.bytes(
            `latest-parent-frame-caches/${ref.file}`,
            ref.sha256,
          );
        await client.initialize({
          assetBase: this.assetBase,
          runtimeModuleUrl: this.runtimeModuleUrl,
          options: { ...common, image: image.slice(), cacheBytes },
          transferImage: true,
        });
        this.check();
        const traces = admitted.filter(
          (t) =>
            t.effectId === group.effectId &&
            Math.fround(t.startTime) === group.startTime,
        );
        const summary = await client.initializeTimeline(traces);
        this.check();
        if (
          summary.effectId !== group.effectId ||
          summary.startTime !== group.startTime ||
          summary.parents.length !== traces.length
        )
          throw Error(
            "Parent timeline initialization differs from replay inputs",
          );
        const expected = new Set(traces.map((t) => t.sequence));
        for (const p of summary.parents) {
          if (!expected.delete(p.sequence))
            throw Error("Duplicate or foreign timeline render owner");
          context.keys.push(p.sequence);
          this.owners.push({
            key: p.sequence,
            effectId: group.effectId,
            ownership: p.ownership,
          });
        }
      }
      const roots = new Set(this.owners.map((o) => o.effectId)),
        emitters = new Set(
          this.owners.flatMap((o) =>
            o.ownership.actors.map((a) => `${o.effectId}:${a.emitterIndex}`),
          ),
        );
      this.summary = {
        effects: roots.size,
        bursts: this.contexts.length,
        traces: admitted.length,
        supportedEmitters: emitters.size,
        omittedTraces: this.gaps.length,
        independentBirthContexts: true,
      };
      this.ready = true;
      return this;
    } catch (error) {
      this.close();
      throw error;
    }
  }
  async frame(time, camera) {
    this.check();
    if (
      !this.ready ||
      !Number.isFinite(time) ||
      !Number.isFinite(Math.fround(time))
    )
      throw Error("Prepared parent playback and finite time required");
    const target = Math.fround(time),
      parents = [];
    // Context ordering is stable. There is no shared RNG between contexts under
    // this admitted policy, and no unbounded queue of simulation frame requests.
    for (const context of this.contexts) {
      if (
        target < context.startTime ||
        (context.completeAt !== null && target >= context.completeAt)
      ) {
        parents.push(
          ...context.keys.map((key) => ({ key, time: target, visible: false })),
        );
        continue;
      }
      // Late seeks must establish native completion rather than assume a tail
      // duration. Each worker request retains its explicit 30-second work bound.
      let at = Math.min(target, context.startTime + 30),
        sample;
      for (;;) {
        sample = await context.client.sampleTimeline(at, camera);
        this.check();
        if (
          sample.time !== Math.fround(at) ||
          JSON.stringify(sample.camera) !== JSON.stringify(camera) ||
          sample.parents.length !== context.keys.length ||
          new Set(sample.parents.map((p) => p.sequence)).size !==
            context.keys.length ||
          sample.parents.some((p) => !context.keys.includes(p.sequence))
        )
          throw Error(
            "Parent timeline returned a foreign or incomplete presentation",
          );
        if (sample.nativeCompleteAt !== null && !sample.fractionalStep)
          context.completeAt = sample.nativeCompleteAt;
        if (at >= target) break;
        if (context.completeAt !== null) {
          sample = null;
          break;
        }
        at = Math.min(target, Math.fround(at + 30));
      }
      if (sample)
        parents.push(
          ...sample.parents.map(({ sequence, ...p }) => ({
            ...p,
            key: sequence,
          })),
        );
      else
        parents.push(
          ...context.keys.map((key) => ({ key, time: target, visible: false })),
        );
    }
    return { time, camera: structuredClone(camera), parents };
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    for (const context of this.contexts) context.client.close();
    this.termination = Promise.all(
      this.contexts.map((c) => c.client.termination),
    );
  }
}
