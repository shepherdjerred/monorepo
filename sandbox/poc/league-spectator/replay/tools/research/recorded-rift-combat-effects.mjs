import {
  hasSennaGroundHitResourceKey,
  sennaGroundHitResourceKey,
} from "./native-rift-effect-create-reader.mjs";

export function collectRecordedRiftCombatEffects(
  packets,
  reader,
  decodeStop,
  visualResourceKeys = [sennaGroundHitResourceKey],
) {
  const resourceKeys = new Set(
    decodeStop === undefined ? [sennaGroundHitResourceKey] : visualResourceKeys,
  );
  const entries = [];
  const handleCounts = new Map();
  const pending = new Map();
  // Scan all creation groups for visual admission because a handle can recur
  // outside the target resource. Stop requests can only refer to an earlier
  // physical packet, including when both requests share a playback clock.
  for (const { kind, context, timeSeconds, sequence, payload } of packets) {
    if (kind === "stop") {
      if (decodeStop === undefined) continue;
      const request = decodeStop(payload);
      if (request === null)
        throw Error(`Invalid particle-stop body at sequence ${sequence}`);
      const entry = pending.get(request.target);
      if (entry !== undefined && entry.sequence < sequence) {
        const { flags, route } = request;
        entry.stops.push({ timeSeconds, sequence, flags, route });
      }
      continue;
    }
    if (decodeStop === undefined && !hasSennaGroundHitResourceKey(payload))
      continue;
    for (const { resourceKey, entries: group } of reader.decode(
      payload,
      context,
    )) {
      for (const { owner, parent, handle, descriptor } of group) {
        if (decodeStop !== undefined)
          handleCounts.set(handle, (handleCounts.get(handle) ?? 0) + 1);
        if (!resourceKeys.has(resourceKey) || descriptor === null) continue;
        const entry = {
          timeSeconds,
          sequence,
          context,
          resourceKey,
          owner,
          parent,
          handle,
          ...descriptor,
          stops: [],
          handleCount: 0,
        };
        entries.push(entry);
        if (decodeStop !== undefined) pending.set(handle, entry);
      }
    }
  }
  for (const entry of entries)
    entry.handleCount = handleCounts.get(entry.handle) ?? 0;
  return entries;
}
