import { PLAYER_START } from "./playback.mjs";
export class ReplayAudio {
  constructor(replay, combat) {
    this.replay = replay;
    this.combat = combat;
    this.sources = new Set();
    this.enabled = false;
    this.lastTime = null;
    this.scheduled = 0;
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
      if (this.definition.bindings[key])
        this.events.push({
          time: e.time,
          id,
          clip: this.definition.bindings[key],
        });
    }
    this.events.sort((a, b) => a.time - b.time);
  }
  async enable() {
    if (!this.context) {
      this.context = new AudioContext();
      this.buffers = new Map();
      this.gain = this.context.createGain();
      this.gain.gain.value = 0.3;
      this.gain.connect(this.context.destination);
      await Promise.all(
        Object.entries(this.definition.clips).map(async ([id, clip]) => {
          const r = await fetch(`/assets/audio/${clip.file}`);
          if (!r.ok) throw Error(`Missing sound ${clip.event}`);
          this.buffers.set(
            id,
            await this.context.decodeAudioData(await r.arrayBuffer()),
          );
        }),
      );
    }
    await this.context.resume();
    this.enabled = true;
    this.reset();
  }
  reset() {
    for (const source of this.sources) source.stop();
    this.sources.clear();
    this.lastTime = null;
  }
  mute() {
    this.enabled = false;
    this.reset();
  }
  update(time, playing, speed, listener) {
    if (!this.enabled) return;
    if (!playing) {
      if (this.lastTime !== null) this.reset();
      return;
    }
    const from = this.lastTime;
    this.lastTime = time;
    if (from === null || time < from || time - from > speed * 0.75) {
      this.reset();
      this.lastTime = time;
      return;
    }
    for (const source of this.sources) source.playbackRate.value = speed;
    let lo = 0,
      hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.events[mid].time <= from) lo = mid + 1;
      else hi = mid;
    }
    for (
      let i = lo;
      i < this.events.length && this.events[i].time <= time;
      i++
    ) {
      const e = this.events[i],
        point = this.combat.state(e.id, e.time).point;
      if (!point) continue;
      const distance = Math.hypot(
        point[0] - listener[0],
        point[1] - listener[1],
      );
      if (distance > 3000) continue;
      const source = this.context.createBufferSource(),
        gain = this.context.createGain();
      source.buffer = this.buffers.get(e.clip);
      source.playbackRate.value = speed;
      gain.gain.value = 1 / (1 + (distance / 1000) ** 2);
      source.connect(gain);
      gain.connect(this.gain);
      source.onended = () => {
        this.sources.delete(source);
        source.disconnect();
        gain.disconnect();
      };
      source.start();
      this.sources.add(source);
      this.scheduled++;
    }
  }
  dispose() {
    this.reset();
    this.context?.close();
  }
}
