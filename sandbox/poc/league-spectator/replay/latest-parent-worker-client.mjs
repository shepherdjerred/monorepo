import { LatestParticleWorkerClient } from "./latest-particle-worker-client.mjs";

// Client tokens stay local; only this worker's integer IDs cross its boundary.
export class LatestParentWorkerClient extends LatestParticleWorkerClient {
  #parents = new Map();
  #checkpoints = new Map();
  #live = new Set();
  constructor({
    workerUrl = new URL("./latest-parent-worker.mjs", import.meta.url),
  } = {}) {
    super({ workerUrl });
  }
  async initialize({
    assetBase,
    options,
    transferImage = false,
    runtimeModuleUrl = new URL("vendor/unicorn_x86_candidate.mjs", assetBase)
      .href,
  }) {
    if (
      transferImage &&
      (!(options.image instanceof Uint8Array) || !options.image.byteLength)
    )
      throw Error("Parent worker requires an owned image buffer to transfer");
    this.summary = await this.request(
      "init",
      { assetBase, options, runtimeModuleUrl },
      transferImage ? [options.image.buffer] : [],
    );
    return this;
  }
  #parent(handle) {
    if (this.closed)
      throw new DOMException("Parent worker closed", "AbortError");
    const id = this.#parents.get(handle);
    if (!id || !this.#live.has(id))
      throw Error("Unowned or inactive parent worker handle");
    return id;
  }
  #checkpoint(handle) {
    if (this.closed)
      throw new DOMException("Parent worker closed", "AbortError");
    const id = this.#checkpoints.get(handle);
    if (!id) throw Error("Unowned parent worker checkpoint");
    return id;
  }
  async createParent(inputs) {
    const result = await this.request("create", inputs),
      handle = Object.freeze({ effectId: this.summary.effectId });
    if (
      !Number.isSafeInteger(result.id) ||
      result.id < 1 ||
      [...this.#parents.values()].includes(result.id)
    )
      throw Error("Invalid parent worker creation response");
    this.#parents.set(handle, result.id);
    this.#live.add(result.id);
    return {
      handle,
      ownership: result.ownership,
      ...(result.placement === undefined
        ? {}
        : { placement: result.placement }),
    };
  }
  suspend(handle, suspended) {
    return this.request("suspend", { id: this.#parent(handle), suspended });
  }
  initializeTimeline(traces) {
    return this.request("timeline", { traces });
  }
  sampleTimeline(time, camera) {
    return this.request("sample", { time, camera });
  }
  inspect(handle) {
    return this.request("inspect", { id: this.#parent(handle) });
  }
  render(handle, camera) {
    return this.request("render", { id: this.#parent(handle), camera });
  }
  drawParameters(handle, emitterIndex, inputs, { binary = true } = {}) {
    return this.request("drawParameters", {
      id: this.#parent(handle),
      emitterIndex,
      inputs,
      options: { binary },
    });
  }
  frame(updates, camera, { captureState = false } = {}) {
    return this.request("frame", {
      updates: updates.map(({ handle, ...update }) => ({
        ...update,
        id: this.#parent(handle),
      })),
      camera,
      captureState,
    });
  }
  async checkpoint() {
    const { id } = await this.request("checkpoint"),
      handle = Object.freeze({});
    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      [...this.#checkpoints.values()].includes(id)
    )
      throw Error("Invalid parent worker checkpoint response");
    this.#checkpoints.set(handle, id);
    return handle;
  }
  async restore(handle) {
    const result = await this.request("restore", {
      id: this.#checkpoint(handle),
    });
    const known = new Set(this.#parents.values());
    if (
      !Array.isArray(result.parents) ||
      result.parents.some((id) => !known.has(id)) ||
      new Set(result.parents).size !== result.parents.length
    )
      throw Error("Invalid restored parent worker ownership");
    this.#live = new Set(result.parents);
  }
  async releaseCheckpoint(handle) {
    await this.request("release", { id: this.#checkpoint(handle) });
    this.#checkpoints.delete(handle);
  }
  worldState() {
    return this.request("world");
  }
  close() {
    this.#parents.clear();
    this.#checkpoints.clear();
    this.#live.clear();
    super.close();
  }
}
