// Browser-side lookahead for the admitted isolated native parent bursts.
// A buffer miss holds the playhead explicitly; late effects are never hidden
// to simulate real-time playback. Native completion must prove each window ends.
import { LatestPreparedEffectPlayback } from "./latest-prepared-effect-playback.mjs";

export class LatestEffectLookahead {
  constructor(effects) {
    if (!effects?.ready || !Array.isArray(effects.playback?.contexts))
      throw Error("Lookahead requires a loaded parent effect renderer");
    this.effects = effects;
    this.revision = 0;
    this.pending = Promise.resolve();
    this.active = null;
    this.error = null;
    this.windows = [];
    for (const context of [...effects.playback.contexts].sort(
      (a, b) => a.startTime - b.startTime,
    )) {
      const start = Math.fround(context.startTime - 15 / 60),
        end = Math.fround(context.startTime + 105 / 60),
        last = this.windows.at(-1);
      if (last && start <= last.end) {
        last.end = Math.max(last.end, end);
        last.contexts.push(context);
      } else
        this.windows.push({
          origin: context.startTime,
          start,
          end,
          contexts: [context],
          buffer: new LatestPreparedEffectPlayback(),
          ready: false,
          complete: false,
        });
    }
    for (const window of this.windows) {
      const times = [];
      for (let tick = -15; ; tick++) {
        const time = Math.fround(window.origin + tick / 60);
        if (time >= window.end) break;
        times.push(time);
        if (times.length >= 181)
          throw Error(
            "Overlapping native bursts exceed the admitted lookahead window",
          );
      }
      times.push(window.end);
      window.times = times;
    }
  }
  invalidate() {
    this.revision++;
    this.active = null;
    this.error = null;
    for (const window of this.windows) {
      window.buffer.clear();
      window.ready = false;
      // Completion already observed in the native runtime remains evidence
      // that a past burst has drained, even after the camera changes.
    }
  }
  required(time) {
    if (this.error) throw this.error;
    if (!Number.isFinite(time)) throw Error("Finite lookahead time required");
    return (
      this.windows.find(
        (w) => time >= w.start && (time <= w.end ? !w.ready : !w.complete),
      ) ?? null
    );
  }
  presentation(time) {
    if (this.required(time)) return null;
    const window = this.windows.find((w) => w.start <= time && time <= w.end);
    if (!window) return null;
    const frame = window.buffer.sample(time);
    return { frame, camera: window.buffer.cameraFor(frame) };
  }
  prefetch({ time, speed, playing, cameraAt }) {
    if (this.error) throw this.error;
    if (this.active) return this.pending;
    const window =
      this.required(time) ??
      (playing
        ? this.windows.find(
            (w) => !w.ready && w.end >= time && w.start <= time + 30 * speed,
          )
        : null);
    if (!window) return this.pending;
    const previous = this.pending,
      revision = this.revision;
    const job = { window, completed: 0, total: window.times.length };
    this.active = job;
    this.pending = (async () => {
      // Camera changes cancel an old preparation after its current worker
      // request. A replacement must wait for that request to finish.
      await previous;
      if (revision !== this.revision) return;
      const done = await window.buffer.prepare({
        effects: this.effects,
        cameraAt,
        times: window.times,
        onProgress: ({ completed, total }) => {
          if (revision === this.revision)
            Object.assign(job, { completed, total });
        },
      });
      if (!done || revision !== this.revision) return;
      if (
        window.contexts.some(
          (c) => c.completeAt === null || c.completeAt > window.end,
        )
      )
        throw Error(
          "Native effects have not completed within the prepared lookahead window",
        );
      window.ready = true;
      window.complete = true;
    })()
      .catch((error) => {
        if (revision === this.revision) this.error = error;
      })
      .finally(() => {
        if (this.active === job) this.active = null;
      });
    return this.pending;
  }
}
