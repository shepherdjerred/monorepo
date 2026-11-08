// At most one complete presentation in flight. A seek/reload invalidates the
// old result; producers still finish or are terminated by their owner.
export class LatestParticleFrameGate {
  revision = 0;
  busy = false;
  invalidate() {
    this.revision++;
  }
  start(prepare, commit, onError) {
    if (this.busy) return false;
    if (![prepare, commit, onError].every((f) => typeof f === "function"))
      throw Error("Particle frame callbacks are required");
    const revision = this.revision;
    this.busy = true;
    this.pending = (async () => {
      try {
        const result = await prepare();
        if (this.revision === revision) commit(result);
      } catch (error) {
        if (this.revision === revision) onError(error);
      } finally {
        this.busy = false;
      }
    })();
    return true;
  }
}
