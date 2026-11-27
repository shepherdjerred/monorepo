import { readClassicLevelCap } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-actor-levels.mjs";
import { readInventoryReplayFooter } from "./verify-recorded-inventory-footer.mjs";

const defaultLevelCap = 18;
const maximumNativeLevel = 255;

export function createRecordedChampionExperienceAccumulator(ids, duration) {
  const actors = new Map(
    [...ids].map((id) => [id, { points: [], levelCaps: [] }]),
  );
  if (actors.size !== 10 || !Number.isFinite(duration) || duration <= 0)
    throw Error(
      "Champion experience requires a complete roster and replay clock.",
    );
  let previousTime = 0;
  function checkClock(timeSeconds) {
    if (
      !Number.isFinite(timeSeconds) ||
      timeSeconds < previousTime ||
      timeSeconds > duration
    )
      throw Error("Invalid recorded champion experience clock.");
    previousTime = timeSeconds;
  }
  return {
    observe(timeSeconds, writes) {
      checkClock(timeSeconds);
      for (const { entityId, experience, level } of writes) {
        const actor = actors.get(entityId);
        if (
          actor === undefined ||
          (experience !== undefined &&
            (!Number.isFinite(experience) || experience < 0)) ||
          (level !== undefined &&
            (!Number.isInteger(level) ||
              level < 1 ||
              level > maximumNativeLevel))
        )
          throw Error("Invalid recorded champion progression.");
        actor.experience = experience ?? actor.experience;
        actor.level = level ?? actor.level;
        if (actor.experience === undefined || actor.level === undefined)
          continue;
        const previous = actor.points.at(-1);
        const point = [timeSeconds, actor.experience, actor.level];
        if (previous?.[0] === timeSeconds)
          actor.points[actor.points.length - 1] = point;
        else if (
          previous?.[1] !== actor.experience ||
          previous?.[2] !== actor.level
        )
          actor.points.push(point);
      }
    },
    observeCap(timeSeconds, entityId, payload) {
      const actor = actors.get(entityId);
      if (actor === undefined) return;
      checkClock(timeSeconds);
      const cap = readClassicLevelCap(payload);
      if (actor.levelCaps.at(-1)?.[0] === timeSeconds) actor.levelCaps.pop();
      if ((actor.levelCaps.at(-1)?.[1] ?? defaultLevelCap) !== cap)
        actor.levelCaps.push([timeSeconds, cap]);
    },
    finish() {
      return [...actors].map(([participantId, { levelCaps, points }]) => {
        if (points.length === 0)
          throw Error("Incomplete recorded champion experience roster.");
        return { participantId, levelCaps, points };
      });
    },
  };
}

export function verifyRecordedChampionExperienceFooter(
  replayBytes,
  binding,
  tracks,
) {
  const rows = JSON.parse(readInventoryReplayFooter(replayBytes).statsJson);
  const finalByActor = new Map(
    tracks.map(({ participantId, points }) => [
      participantId,
      points.at(-1)?.[2],
    ]),
  );
  const visited = new Set();
  if (
    !Array.isArray(rows) ||
    rows.length !== 10 ||
    tracks.length !== 10 ||
    finalByActor.size !== 10 ||
    binding.verified.length !== 10 ||
    binding.unresolved.length !== 0
  )
    throw Error(
      "Terminal champion experience requires a complete verified roster.",
    );
  for (const { context, footerRow } of binding.verified) {
    const level = rows[footerRow - 1]?.LEVEL;
    if (
      visited.has(footerRow) ||
      typeof level !== "string" ||
      !/^[1-9]\d{0,2}$/u.test(level) ||
      Number(level) > maximumNativeLevel ||
      finalByActor.get(context) !== Number(level)
    )
      throw Error(
        "Recorded experience level differs from the bound replay footer.",
      );
    visited.add(footerRow);
    finalByActor.delete(context);
  }
}
