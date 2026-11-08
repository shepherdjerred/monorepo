// A bounded, camera-specific buffer generated from the current replay in-browser.
// No simulation ticks or emitter layers are dropped to make playback cheaper.
export class LatestPreparedEffectPlayback {
  #cameras = new WeakMap();
  constructor({ maximumBytes = 64 * 1024 * 1024 } = {}) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
      throw Error("A positive prepared playback memory limit is required");
    this.maximumBytes = maximumBytes;
    this.revision = 0;
    this.clear();
  }
  clear() {
    this.revision++;
    this.frames = [];
    this.bytes = 0;
    this.camera = null;
    this.#cameras = new WeakMap();
    this.preparing = false;
  }
  async prepare({ effects, camera, cameraAt, times, onProgress = () => {} }) {
    if (
      !effects?.ready ||
      !effects.enabled ||
      (cameraAt === undefined
        ? !camera?.clone
        : typeof cameraAt !== "function") ||
      !Array.isArray(times) ||
      times.length < 2 ||
      times.length > 181 ||
      times.some((t, i) => !Number.isFinite(t) || (i > 0 && t <= times[i - 1]))
    )
      throw Error(
        "Prepared playback requires enabled effects and ordered bounded times",
      );
    this.clear();
    const revision = this.revision,
      frames = [],
      buffers = new Set();
    const fixedCamera = camera?.clone() ?? null;
    this.preparing = true;
    const began = performance.now();
    try {
      for (const time of times) {
        if (revision !== this.revision) return false;
        const view = cameraAt ? cameraAt(time) : fixedCamera;
        if (!view?.clone) throw Error("Prepared effect camera is missing");
        const ownedCamera = view.clone();
        const frame = await effects.prepareFrame(time, ownedCamera);
        if (revision !== this.revision) return false;
        this.#cameras.set(frame, ownedCamera);
        const collect = (value) => {
          if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
          else if (Array.isArray(value)) value.forEach(collect);
          else if (value && typeof value === "object")
            Object.values(value).forEach(collect);
        };
        collect(frame);
        const bytes = [...buffers].reduce((n, b) => n + b.byteLength, 0);
        if (bytes > this.maximumBytes)
          throw Error(
            "Prepared effect preview exceeds its 64 MiB geometry budget",
          );
        frames.push(frame);
        onProgress({
          completed: frames.length,
          total: times.length,
          bytes,
          elapsedMs: performance.now() - began,
        });
      }
      this.frames = frames;
      this.bytes = [...buffers].reduce((n, b) => n + b.byteLength, 0);
      this.camera = fixedCamera;
      this.preparationMs = performance.now() - began;
      return true;
    } catch (error) {
      if (revision !== this.revision) return false;
      throw error;
    } finally {
      if (revision === this.revision) this.preparing = false;
    }
  }
  sample(time) {
    if (!Number.isFinite(time) || !this.frames.length)
      throw Error("A prepared effect sequence and finite time are required");
    if (time < this.frames[0].time || time > this.frames.at(-1).time)
      throw Error("Time is outside the prepared effect sequence");
    let lo = 0,
      hi = this.frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.frames[mid].time <= time) lo = mid + 1;
      else hi = mid;
    }
    return this.frames[Math.max(0, lo - 1)];
  }
  cameraFor(frame) {
    const camera = this.#cameras.get(frame);
    if (!camera) throw Error("Unowned prepared effect camera");
    return camera;
  }
}
