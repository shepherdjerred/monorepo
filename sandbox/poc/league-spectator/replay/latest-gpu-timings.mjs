// Explicit recordings only. Availability polling never waits for the GPU, and
// query pressure skips measurements rather than delaying or changing rendering.
export class LatestGpuTimings {
  constructor(gl, { maximumPending = 8, maximumSamples = 10000 } = {}) {
    if (
      !Number.isInteger(maximumPending) ||
      maximumPending < 1 ||
      !Number.isInteger(maximumSamples) ||
      maximumSamples < 1
    )
      throw Error("Bounded GPU timing capacities required");
    this.gl = gl;
    this.extension = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    this.maximumPending = maximumPending;
    this.maximumSamples = maximumSamples;
    this.pending = [];
    this.samples = [];
    this.active = null;
    this.closed = false;
    this.skippedCapacity = 0;
    this.disjointDiscarded = 0;
    this.skippedDisjoint = 0;
    this.skippedExternalQuery = 0;
    this.disjoint = false;
    this.boundary = this.extension ? null : "gpu-timer-extension-unavailable";
  }
  poll() {
    if (this.closed || this.boundary) return;
    if (this.gl.isContextLost()) {
      this.boundary = "gpu-context-lost";
      return;
    }
    this.disjoint = !!this.gl.getParameter(this.extension.GPU_DISJOINT_EXT);
    if (this.disjoint) {
      this.disjointDiscarded += this.pending.length;
      for (const row of this.pending) this.gl.deleteQuery(row.query);
      this.pending = [];
      return;
    }
    const waiting = [];
    for (const row of this.pending) {
      if (
        !this.gl.getQueryParameter(row.query, this.gl.QUERY_RESULT_AVAILABLE)
      ) {
        waiting.push(row);
        continue;
      }
      const nanoseconds = this.gl.getQueryParameter(
        row.query,
        this.gl.QUERY_RESULT,
      );
      if (!Number.isFinite(nanoseconds) || nanoseconds < 0)
        throw Error("Invalid completed GPU timer result");
      this.samples.push({ ...row.frame, gpuMs: nanoseconds / 1e6 });
      this.gl.deleteQuery(row.query);
    }
    this.pending = waiting;
  }
  begin(frame) {
    if (this.closed) throw Error("GPU timing recording closed");
    if (this.active) throw Error("GPU timing query already active");
    this.poll();
    if (this.boundary) return false;
    if (this.disjoint) {
      this.skippedDisjoint++;
      return false;
    }
    if (this.samples.length + this.pending.length >= this.maximumSamples) {
      this.boundary = "gpu-timer-sample-capacity";
      return false;
    }
    if (this.pending.length >= this.maximumPending) {
      this.skippedCapacity++;
      return false;
    }
    if (
      this.gl.getQuery(this.extension.TIME_ELAPSED_EXT, this.gl.CURRENT_QUERY)
    ) {
      this.skippedExternalQuery++;
      return false;
    }
    const query = this.gl.createQuery();
    if (!query) {
      this.boundary = "gpu-timer-allocation-failed";
      return false;
    }
    this.active = { query, frame: structuredClone(frame) };
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
    return true;
  }
  end() {
    if (!this.active) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }
  finish() {
    if (this.active) throw Error("Cannot finish an active GPU query");
    if (this.closed) throw Error("GPU timing recording already closed");
    this.poll();
    const pendingWhenStopped = this.pending.length;
    for (const row of this.pending) this.gl.deleteQuery(row.query);
    this.pending = [];
    this.closed = true;
    return {
      supported: !!this.extension,
      boundary: this.boundary,
      samples: structuredClone(this.samples),
      skippedCapacity: this.skippedCapacity,
      disjointDiscarded: this.disjointDiscarded,
      skippedDisjoint: this.skippedDisjoint,
      skippedExternalQuery: this.skippedExternalQuery,
      pendingWhenStopped,
      scope: {
        asynchronous: true,
        wholeScene: true,
        effectsCostIsolated: false,
        unavailableResultsWaitedFor: false,
        acceptanceEstablished: false,
      },
    };
  }
}
