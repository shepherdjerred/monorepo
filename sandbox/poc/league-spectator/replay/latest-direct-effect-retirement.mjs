// Original 16.21.829.8620 wrapper routing and parent flag transitions only.
// This kernel does not implement parent ticks, tails, queues or destruction.
const unsigned = (value, maximum) =>
  Number.isInteger(value) && value >= 0 && value <= maximum;

export function directRetirementFlags(initialFlags, mode) {
  if (!unsigned(initialFlags, 0xffff) || typeof mode !== "boolean")
    throw Error("Explicit unsigned parent flags and retirement mode required");
  const enqueue = !(initialFlags & 0x80);
  return {
    flags: !enqueue
      ? initialFlags
      : mode
        ? (initialFlags & 0xff5c) | 0x82
        : (initialFlags | 0xa0) & 0xfffe,
    enqueue,
  };
}

export function directRemovalFlagTransition({
  reasonByte,
  objectFlags,
  parentFlags,
  effectPresent,
}) {
  if (
    !unsigned(reasonByte, 0xff) ||
    !unsigned(objectFlags, 0xffffffff) ||
    !unsigned(parentFlags, 0xffff) ||
    typeof effectPresent !== "boolean"
  )
    throw Error(
      "Explicit decoded removal reason and resolved wrapper inputs required",
    );
  if (!effectPresent)
    return {
      objectFlags,
      parentFlags,
      enqueue: false,
      mode: null,
      entityEffectCleared: false,
    };
  objectFlags = (objectFlags | (reasonByte === 61 ? 0x800 : 0x10000000)) >>> 0;
  // Original propagation gives the mode-true bit precedence, including when
  // it was already present before an ordinary reason61 removal request.
  const mode = !!(objectFlags & 0x10000000);
  const retirement = directRetirementFlags(parentFlags, mode);
  return {
    objectFlags,
    parentFlags: retirement.flags,
    enqueue: retirement.enqueue,
    mode,
    entityEffectCleared: true,
  };
}
