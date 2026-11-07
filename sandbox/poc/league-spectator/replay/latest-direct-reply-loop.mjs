// A wall clock is independent of worker completion and rendering cadence.
export class LatestDesiredReplayClock {
  constructor(
    { time = 0, playing = false, speed = 1, endTime = 0 } = {},
    wallTime = 0,
  ) {
    this.configure({ time, playing, speed, endTime }, wallTime);
  }
  configure({ time, playing, speed, endTime }, wallTime) {
    if (
      ![time, speed, endTime, wallTime].every(Number.isFinite) ||
      time < 0 ||
      endTime < time ||
      speed <= 0 ||
      typeof playing !== "boolean"
    )
      throw Error("Finite desired replay clock required");
    this.anchorTime = time;
    this.anchorWallTime = wallTime;
    this.playing = playing;
    this.speed = speed;
    this.endTime = endTime;
  }
  read(wallTime) {
    if (!Number.isFinite(wallTime))
      throw Error("Finite replay wall time required");
    return Math.min(
      this.endTime,
      this.anchorTime +
        (this.playing
          ? (Math.max(0, wallTime - this.anchorWallTime) * this.speed) / 1000
          : 0),
    );
  }
}

// Exactly one asynchronous request and one transient claimed result. The next
// request starts before synchronous presentation; run-to-completion consumes the
// ready slot before another message callback can run. No ready replacement.
export class LatestDirectReplyLoop {
  constructor({
    now,
    nextIntent,
    request,
    accept,
    claim,
    isClaimCurrent,
    release,
    present,
    onError,
  }) {
    if (
      ![
        now,
        nextIntent,
        request,
        accept,
        claim,
        isClaimCurrent,
        release,
        present,
        onError,
      ].every((f) => typeof f === "function")
    )
      throw Error("Complete direct reply loop callbacks required");
    Object.assign(this, {
      now,
      nextIntent,
      request,
      accept,
      claim,
      isClaimCurrent,
      release,
      present,
      onError,
    });
    this.epoch = 0;
    this.active = null;
    this.ready = null;
    this.closed = false;
    this.lastKey = null;
    this.lastPresented = null;
    this.counts = {
      accepted: 0,
      completed: 0,
      presented: 0,
      epochRejected: 0,
      superseded: 0,
    };
  }
  invalidate() {
    this.epoch++;
    this.lastKey = null;
  }
  close() {
    this.closed = true;
    this.invalidate();
  }
  tick() {
    this.#pump(false);
  }
  snapshot() {
    return {
      epoch: this.epoch,
      inFlight: this.active !== null,
      ready: this.ready !== null,
      ...this.counts,
      lastPresented: this.lastPresented,
    };
  }
  #pump(allowReady) {
    if (this.closed || this.active || (this.ready && !allowReady)) return;
    try {
      const intent = this.nextIntent(this.now());
      if (intent === null) return;
      if (
        !intent ||
        typeof intent.key !== "string" ||
        !Number.isFinite(intent.time)
      )
        throw Error("Owned direct frame intent required");
      if (intent.key === this.lastKey) return;
      const active = { epoch: this.epoch, intent, requestedAt: this.now() };
      this.active = active;
      this.lastKey = intent.key;
      this.counts.accepted++;
      Promise.resolve(this.request(intent)).then(
        (result) => this.#complete(active, result),
        (error) => this.#reject(active, error),
      );
    } catch (error) {
      this.#fail(error);
    }
  }
  #complete(active, result) {
    let ticket;
    try {
      if (this.active !== active) {
        if (!this.closed) throw Error("Foreign reply loop completion");
        return;
      }
      this.active = null;
      this.counts.completed++;
      if (this.closed) return;
      if (active.epoch !== this.epoch) {
        this.counts.epochRejected++;
        return;
      }
      if (!this.accept(result, active.intent)) {
        this.counts.superseded++;
        this.lastKey = null;
        return;
      }
      ticket = this.claim(result, active.epoch);
      const ready = {
        ...active,
        result,
        ticket,
        presentationId: this.counts.presented + 1,
      };
      this.ready = ready;
      this.#pump(true);
      if (this.closed) return;
      if (
        active.epoch !== this.epoch ||
        !this.isClaimCurrent(ticket, active.epoch)
      ) {
        this.counts.epochRejected++;
        return;
      }
      const returned = this.present(ready);
      if (returned && typeof returned.then === "function") {
        Promise.resolve(returned).catch(() => {});
        throw Error(
          "Direct presentation must complete synchronously before yielding",
        );
      }
      this.counts.presented++;
      this.lastPresented = {
        id: ready.presentationId,
        epoch: active.epoch,
        time: result.time,
        key: active.intent.key,
        operation: result.operation,
        simulationSteps: result.packet.metrics.simulationSteps,
        requestedAt: active.requestedAt,
        submittedAt: this.now(),
      };
    } catch (error) {
      this.#fail(error);
    } finally {
      this.ready = null;
      if (ticket)
        try {
          this.release(ticket);
        } catch (error) {
          this.#fail(error);
        }
      this.#pump(false);
    }
  }
  #reject(active, error) {
    if (this.active === active) this.active = null;
    if (this.closed) return;
    if (active.epoch !== this.epoch) {
      this.#pump(false);
      return;
    }
    this.#fail(error);
  }
  #fail(error) {
    if (this.closed) return;
    this.closed = true;
    this.failure = error;
    try {
      this.onError(error);
    } catch (callbackError) {
      this.onErrorFailure = callbackError;
    }
  }
}
