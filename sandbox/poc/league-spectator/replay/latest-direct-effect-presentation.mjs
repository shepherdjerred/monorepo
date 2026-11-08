// Serialize accepted simulation requests and coalesce only adjacent, unstarted
// camera draws. This does not activate effects or change runtime eligibility.
export class DirectEffectBackpressureError extends Error {
  constructor() {
    super("Direct effect presentation advance capacity reached");
    this.name = "DirectEffectBackpressureError";
  }
}

const abort = () =>
  new DOMException("Direct effect presentation closed", "AbortError");

// Own all advance/camera operations for this client while attached. Direct
// checkpoint restores must use a new coordinator so its accepted time remains
// aligned with the worker. Callers commit only ready, presentable results.
export class LatestDirectEffectPresentation {
  #completed = new WeakSet();
  #claim = null;

  constructor(client, { maximumAdvances = 2 } = {}) {
    if (
      typeof client?.frame !== "function" ||
      typeof client?.camera !== "function" ||
      !Number.isSafeInteger(maximumAdvances) ||
      maximumAdvances < 1
    )
      throw Error(
        "Direct presentation requires a client and bounded advance capacity",
      );
    this.client = client;
    this.maximumAdvances = maximumAdvances;
    this.queue = [];
    this.active = null;
    this.nextId = 1;
    this.latestIntent = 0;
    this.acceptedTime = 0;
    this.hasAcceptedAdvance = false;
    this.closed = false;
  }

  sample(time, camera) {
    return this.hasAcceptedAdvance && time === this.acceptedTime
      ? this.camera(camera)
      : this.advance(time, camera);
  }

  isCurrent(result) {
    return (
      !this.closed &&
      this.#completed.has(result) &&
      result.status === "ready" &&
      result.requestId === this.latestIntent
    );
  }

  claimCurrent(result, epoch) {
    if (
      this.#claim ||
      !this.isCurrent(result) ||
      !Number.isSafeInteger(epoch) ||
      epoch < 0
    )
      throw Error("One owned current presentation claim required");
    return (this.#claim = Object.freeze({ result, epoch }));
  }

  isClaimCurrent(ticket, epoch) {
    return (
      !this.closed &&
      ticket !== null &&
      ticket === this.#claim &&
      ticket.epoch === epoch
    );
  }

  releaseClaim(ticket) {
    if (!ticket || ticket !== this.#claim)
      throw Error("Foreign or consumed presentation claim");
    this.#claim = null;
  }

  advance(time, camera) {
    if (!Number.isFinite(time) || time < 0)
      return Promise.reject(Error("Invalid direct presentation time"));
    if (this.closed) return Promise.reject(abort());
    const outstanding =
      Number(this.active?.type === "advance") +
      this.queue.filter((request) => request.type === "advance").length;
    if (outstanding >= this.maximumAdvances)
      return Promise.reject(new DirectEffectBackpressureError());
    return this.#request("advance", time, camera);
  }

  camera(camera) {
    if (this.closed) return Promise.reject(abort());
    return this.#request("camera", this.acceptedTime, camera);
  }

  #request(type, time, camera) {
    let view;
    try {
      view = structuredClone(camera);
      if (
        !["right", "up"].every(
          (key) =>
            view[key]?.length === 3 &&
            Array.from(view[key]).every(Number.isFinite),
        )
      )
        throw Error("Finite direct presentation camera required");
    } catch (error) {
      return Promise.reject(error);
    }
    const requestId = this.nextId++;
    this.latestIntent = requestId;
    if (type === "advance") {
      this.acceptedTime = time;
      this.hasAcceptedAdvance = true;
    }
    return new Promise((resolve, reject) => {
      const request = { type, time, camera: view, requestId, resolve, reject };
      const tail = this.queue.at(-1);
      // A later simulation command is a causal boundary. Never coalesce across
      // it, and never discard or replace an accepted advance (including seeks).
      if (type === "camera" && tail?.type === "camera") {
        this.queue.pop();
        tail.resolve({
          status: "superseded",
          requestId: tail.requestId,
          supersededBy: requestId,
          time: tail.time,
          presentable: false,
        });
      }
      this.queue.push(request);
      this.#drain();
    });
  }

  async #drain() {
    if (this.active || this.closed) return;
    const request = this.queue.shift();
    if (!request) return;
    this.active = request;
    try {
      const packet = await (request.type === "advance"
        ? this.client.frame(request.time, request.camera)
        : this.client.camera(request.camera));
      if (this.closed) return;
      if (packet?.time !== request.time || !Array.isArray(packet.draws))
        throw Error(
          "Direct presentation packet differs from its ordered request",
        );
      const result = Object.freeze({
        status: "ready",
        requestId: request.requestId,
        time: request.time,
        operation: request.type,
        presentable: request.requestId === this.latestIntent,
        camera: request.camera,
        packet,
      });
      this.#completed.add(result);
      request.resolve(result);
    } catch (error) {
      if (!this.closed) this.#fail(error);
    } finally {
      this.active = null;
      this.#drain();
    }
  }

  #fail(error) {
    this.closed = true;
    this.active?.reject(error);
    for (const request of this.queue) request.reject(error);
    this.queue.length = 0;
  }

  close() {
    if (!this.closed) this.#fail(abort());
  }
}
