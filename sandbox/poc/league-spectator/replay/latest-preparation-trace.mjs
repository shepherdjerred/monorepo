export function assertLatestPreparationEvent(event) {
  if (
    !event ||
    typeof event.source !== "string" ||
    typeof event.stage !== "string" ||
    event.stage.length > 96 ||
    !["begin", "end"].includes(event.phase) ||
    !Number.isFinite(event.elapsedMs) ||
    event.elapsedMs < 0 ||
    !Number.isFinite(event.atEpochMs) ||
    !event.counts ||
    Object.getPrototypeOf(event.counts) !== Object.prototype ||
    Object.keys(event.counts).length > 16 ||
    !Object.values(event.counts).every(Number.isFinite)
  )
    throw Error("Bounded preparation diagnostic event required");
  return event;
}
export function createLatestPreparationTrace(
  onPreparation = null,
  source = "renderer",
) {
  if (onPreparation !== null && typeof onPreparation !== "function")
    throw Error("Explicit preparation diagnostic callback required");
  const started = performance.now();
  return (stage, phase, counts = {}) => {
    if (onPreparation === null) return;
    const now = performance.now();
    onPreparation(
      assertLatestPreparationEvent({
        source,
        stage,
        phase,
        elapsedMs: now - started,
        atEpochMs: performance.timeOrigin + now,
        counts: { ...counts },
      }),
    );
  };
}
