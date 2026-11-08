import { indexMovement, sampleMovement, PLAYER_START } from "./playback.mjs";

export function latest(track, time) {
  if (!track?.length) return null;
  let lo = 0,
    hi = track.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (track[mid].time <= time) lo = mid + 1;
    else hi = mid;
  }
  return track[lo - 1] ?? null;
}

export class CombatPlayback {
  constructor(events, tracks) {
    this.tracks = tracks;
    this.attacks = indexMovement(events.filter((e) => e.kind === "attack"));
    this.casts = indexMovement(
      events.filter((e) => e.kind === "cast" && e.slot < 4),
    );
    this.statTracks = new Map();
    for (const event of events) {
      if (event.kind !== "stats") continue;
      for (const update of event.updates) {
        if (!this.statTracks.has(update.entityId))
          this.statTracks.set(update.entityId, []);
        const track = this.statTracks.get(update.entityId);
        track.push({ ...track.at(-1), ...update, time: event.time });
      }
    }
    this.buffTracks = new Map();
    for (const e of events) {
      if (!e.kind.startsWith("buff")) continue;
      if (!this.buffTracks.has(e.entityId))
        this.buffTracks.set(e.entityId, new Map());
      const slots = this.buffTracks.get(e.entityId);
      if (!slots.has(e.slot)) slots.set(e.slot, []);
      const track = slots.get(e.slot),
        previous = track.at(-1);
      if (e.kind === "buffAdd") track.push({ ...e, active: true });
      else if (e.kind === "buffRemove") track.push({ ...e, active: false });
      else if (previous?.active)
        track.push({
          ...previous,
          time: e.time,
          ...(e.counterKind === "stacks"
            ? { count: e.count }
            : { numericCounter: e.count }),
        });
    }
    this.deaths = indexMovement(
      events
        .filter((e) => e.kind === "death" || e.kind === "unitDeath")
        .map((e) => ({ ...e, entityId: e.victimId ?? e.entityId })),
    );
    this.respawns = indexMovement(events.filter((e) => e.kind === "respawn"));
    this.removals = indexMovement(events.filter((e) => e.kind === "remove"));
    this.events = events;
  }
  stats(id, time) {
    return latest(this.statTracks.get(id), time);
  }
  buffs(id, time) {
    return [...(this.buffTracks.get(id)?.values() ?? [])]
      .map((track) => latest(track, time))
      .filter((e) => e?.active);
  }
  state(id, time, spawn = null) {
    const death = latest(this.deaths.get(id), time),
      respawn = latest(this.respawns.get(id), time);
    const dead =
      death &&
      (!respawn || death.time > respawn.time) &&
      (!spawn || death.time >= spawn.time);
    const movement = sampleMovement(
      this.tracks.get(id),
      dead ? death.time : time,
    );
    const atRespawn =
      respawn && !dead && (!movement || movement.event.time < respawn.time);
    const point = atRespawn
      ? respawn.position
      : (movement?.point ??
        (spawn?.position ? [spawn.position[0], spawn.position[2]] : null));
    return {
      point,
      movement,
      dead,
      death,
      respawn,
      moving: !dead && !atRespawn && Boolean(movement?.moving),
    };
  }
  action(id, time, clips, semantic, state) {
    const choose = (kind, event) => {
      const names = semantic[kind];
      if (!names?.length) return null;
      const definition =
        event.kind === "cast"
          ? this.spells?.[
              `${event.sourceName.toLowerCase()}:${event.spellHash}`
            ]
          : null;
      const clip =
        (definition?.animation &&
          clips.get(definition.animation.toLowerCase())) ||
        clips.get(names[0].toLowerCase());
      if (!clip) throw Error(`Missing prepared clip ${names[0]}`);
      const windup = event.castTime + (event.extraCastTime ?? 0);
      const rate =
        kind.startsWith("spell") && definition?.castFrame > 0 && windup > 0
          ? definition.castFrame / 30 / windup
          : 1;
      const phase = (time - event.time) * rate;
      // A later moving path interrupts recovery; mandatory cast windup is retained.
      if (
        kind !== "death" &&
        state.moving &&
        state.movement.event.time > event.time + 0.001 &&
        (!definition?.cantCancelWindup || time >= event.time + windup)
      )
        return null;
      if (kind !== "death" && phase >= clip.duration) return null;
      return {
        clip,
        phase: Math.min(phase, Math.max(0, clip.duration - 0.0001)),
        kind,
        event,
      };
    };
    if (state.dead) return choose("death", state.death);
    const cast = latest(this.casts.get(id), time),
      attack = latest(this.attacks.get(id), time);
    if (cast && (!attack || cast.time >= attack.time))
      return choose(`spell${cast.slot + 1}`, cast);
    if (attack) {
      const action = choose("attack", attack);
      if (action) return action;
    }
    return null;
  }
  facing(id, time, action) {
    if (action?.kind === "attack") {
      const target = this.state(action.event.targetId, time).point;
      return (
        target ?? [
          action.event.targetPosition[0],
          action.event.targetPosition[2],
        ]
      );
    }
    if (action?.kind.startsWith("spell")) {
      const p = action.event.positions[2];
      return [p[0], p[2]];
    }
    return null;
  }
  isChampion(id) {
    return id >= PLAYER_START && id < PLAYER_START + 10;
  }
}
