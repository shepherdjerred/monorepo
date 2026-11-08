// Explicit request ownership; termination rejects pending work instead of
// allowing a discarded replay's response to affect a later replay.
export class LatestParticleWorkerClient {
  constructor({
    workerUrl = new URL("./latest-particle-worker.mjs", import.meta.url),
  } = {}) {
    this.worker = new Worker(workerUrl, { type: "module" });
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.worker.onmessage = ({ data }) => {
      if (this.closed) return;
      if (data?.version === 1 && data.fatal) {
        this.fail(
          Error(
            typeof data.fatal.message === "string"
              ? data.fatal.message
              : "Invalid particle worker fatal response",
          ),
        );
        return;
      }
      const request = this.pending.get(data?.id);
      if (
        !data ||
        data.version !== 1 ||
        typeof data.ok !== "boolean" ||
        !request
      ) {
        this.fail(Error("Invalid or unowned particle worker response"));
        return;
      }
      this.pending.delete(data.id);
      if (data.ok) request.resolve(data.result);
      else {
        if (
          !data.error ||
          typeof data.error.message !== "string" ||
          typeof data.error.name !== "string"
        ) {
          const error = Error("Invalid particle worker error response");
          request.reject(error);
          this.fail(error);
          return;
        }
        const error = Error(data.error.message);
        error.name = data.error.name;
        request.reject(error);
        this.fail(error);
      }
    };
    this.worker.onerror = (event) => this.fail(Error(event.message));
    this.worker.onmessageerror = () =>
      this.fail(Error("Particle worker response could not be decoded"));
  }
  fail(error) {
    if (this.closed) return;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    this.closed = true;
    this.termination = Promise.resolve(this.worker.terminate());
  }
  request(type, payload, transfer = []) {
    if (this.closed)
      return Promise.reject(
        new DOMException("Particle worker closed", "AbortError"),
      );
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ version: 1, id, type, payload }, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async initialize({
    kind,
    traces,
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
      throw Error("Particle worker requires an owned image buffer to transfer");
    const result = await this.request(
      "init",
      {
        kind,
        traces,
        assetBase,
        options,
        runtimeModuleUrl,
      },
      transferImage ? [options.image.buffer] : [],
    );
    this.summary = result;
    return this;
  }
  bindEmitter(effectId, emitterIndex, sourceDefinitionSha256) {
    return this.request("bind", {
      effectId,
      emitterIndex,
      sourceDefinitionSha256,
    });
  }
  frame(time, view) {
    return this.request("frame", { time, view });
  }
  close() {
    if (this.closed) return;
    this.fail(new DOMException("Particle worker closed", "AbortError"));
  }
}
