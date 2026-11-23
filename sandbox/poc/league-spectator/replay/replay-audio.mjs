import { PLAYER_START } from "./playback.mjs";

const MAX_AUDIO_FRAME_GAP_SECONDS = 0.75;

export class ReplayAudio {
  constructor(replay, combat) {
    this.replay = replay;
    this.combat = combat;
    this.sources = new Set();
    this.enabled = false;
    this.lastTime = null;
    this.scheduled = 0;
    this.enableRequest = 0;
    this.disposed = false;
  }
  async load() {
    const r = await fetch("/assets/audio/package.json");
    if (!r.ok) throw Error("Missing static audio package");
    this.definition = await r.json();
    if (this.definition.build !== this.replay.build)
      throw Error("Audio package build mismatch");
    this.events = [];
    for (const e of this.replay.gameplay) {
      const id = e.kind === "death" ? e.victimId : e.entityId;
      const champion =
        this.replay.roster[id - PLAYER_START]?.champion.toLowerCase();
      if (!champion) continue;
      let key;
      if (e.kind === "cast") key = `${champion}:${e.spellHash}`;
      else if (e.kind === "attack") key = `${champion}:attack`;
      else if (e.kind === "death") key = `${champion}:death`;
      if (!key || !Object.hasOwn(this.definition.bindings, key)) continue;
      const clip = this.definition.bindings[key];
      if (!Object.hasOwn(this.definition.clips, clip))
        throw Error(`Missing audio clip for binding ${key}`);
      this.events.push({ time: e.time, id, clip });
    }
    this.events.sort((a, b) => a.time - b.time);
  }
  async enable() {
    if (this.disposed || this.enabled) return;
    const request = ++this.enableRequest;
    const context = (this.context ??= new AudioContext());
    if (!this.gain) {
      this.gain = context.createGain();
      this.gain.gain.value = 0.3;
      this.gain.connect(context.destination);
    }
    // Resume during the initiating gesture, before any network await.
    const resume = context.resume();
    if (!this.buffers && !this.bufferLoad) {
      const load = new AbortController();
      this.clipLoad = load;
      this.bufferLoad = Promise.all(
        Object.entries(this.definition.clips).map(async ([id, clip]) => {
          const r = await fetch(`/assets/audio/${clip.file}`, {
            signal: load.signal,
          });
          if (!r.ok) throw Error(`Missing sound ${clip.event}`);
          const bytes = await r.arrayBuffer();
          load.signal.throwIfAborted();
          return [id, await context.decodeAudioData(bytes)];
        }),
      )
        .then((entries) => {
          if (!load.signal.aborted) this.buffers = new Map(entries);
        })
        .catch((error) => {
          load.abort();
          throw error;
        })
        .finally(() => {
          if (this.clipLoad === load) {
            this.clipLoad = null;
            this.bufferLoad = null;
          }
        });
    }
    try {
      await Promise.all([this.bufferLoad, resume]);
    } catch (error) {
      if (request !== this.enableRequest) return;
      throw error;
    }
    if (request !== this.enableRequest) return;
    this.enabled = true;
    this.reset();
  }
  pause() {
    for (const voice of this.sources) {
      voice.source.stop();
      voice.disconnect();
    }
    this.sources.clear();
  }
  reset(time = null) {
    this.pause();
    this.lastTime = time;
    this.includeStart = true;
  }
  mute() {
    this.enableRequest++;
    this.enabled = false;
    this.reset();
  }
  update(time, playing, speed, listener, wallSecondsSinceFrame = 0) {
    if (!this.enabled) return;
    if (!playing) {
      this.pause();
      return;
    }
    // The viewer clamps replay time after a wall-clock stall. Voices have
    // already advanced on the audio clock, so stop them and keep the cue cursor.
    if (wallSecondsSinceFrame > MAX_AUDIO_FRAME_GAP_SECONDS) this.pause();
    const from = this.lastTime;
    const discontinuity =
      from !== null &&
      (time < from || time - from > speed * MAX_AUDIO_FRAME_GAP_SECONDS);
    if (discontinuity) this.reset(time);
    const start = this.lastTime ?? time;
    const includeStart = this.lastTime === null || this.includeStart;
    this.lastTime = time;
    this.includeStart = false;
    const audioTime = this.context.currentTime;
    for (const { source } of this.sources)
      source.playbackRate.setValueAtTime(speed, audioTime);
    let lo = 0,
      hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const eventTime = this.events[mid].time;
      if (eventTime < start || (!includeStart && eventTime === start))
        lo = mid + 1;
      else hi = mid;
    }
    for (
      let i = lo;
      i < this.events.length && this.events[i].time <= time;
      i++
    ) {
      const e = this.events[i];
      const buffer = this.buffers.get(e.clip);
      // The frame has already crossed this cue. Use its elapsed replay time
      // as the buffer offset, independently of Web Audio's playback rate.
      const offset = time - e.time;
      if (offset >= buffer.duration) continue;
      const point = this.combat.state(e.id, e.time).point;
      if (!point) continue;
      const distance = Math.hypot(
        point[0] - listener[0],
        point[1] - listener[1],
      );
      if (distance > 3000) continue;
      const source = this.context.createBufferSource(),
        gain = this.context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = speed;
      gain.gain.value = 1 / (1 + (distance / 1000) ** 2);
      source.connect(gain);
      gain.connect(this.gain);
      const disconnect = () => {
        source.onended = null;
        source.disconnect();
        gain.disconnect();
      };
      const voice = { source, disconnect };
      source.onended = () => {
        this.sources.delete(voice);
        disconnect();
      };
      source.start(audioTime, offset);
      this.sources.add(voice);
      this.scheduled++;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mute();
    this.clipLoad?.abort();
    this.clipLoad = null;
    this.bufferLoad = null;
    this.buffers = null;
    this.gain?.disconnect();
    this.gain = null;
    const context = this.context;
    this.context = null;
    return context?.close();
  }
}
