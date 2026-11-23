const positive = (value) => Number.isSafeInteger(value) && value > 0;

// One owner issues orders for actual draw completions and RAF observations.
// The values establish callback order, never replace or adjust browser clocks.
export function createPresentationObservationOrder() {
  let sequence = 0;
  return () => {
    if (sequence === Number.MAX_SAFE_INTEGER)
      throw Error("Presentation observation order exhausted");
    return ++sequence;
  };
}

export function validatePresentationObservationOrder(frames, ticks, boundary) {
  const events = [];
  const add = (row, kind, order, wallTime) => {
    if (
      !positive(order) ||
      !positive(row.drawId) ||
      !Number.isFinite(wallTime) ||
      wallTime < 0
    )
      throw Error("Identified presentation observation order required");
    events.push({ row, kind, order, wallTime });
  };
  let previous = null;
  for (const row of frames) {
    if (previous && row.drawOrder <= previous.drawOrder)
      throw Error("Draw completion orders must increase");
    add(row, "draw", row.drawOrder, row.drawWallTime);
    previous = row;
  }
  previous = null;
  for (const row of ticks) {
    if (
      !positive(row.drawOrder) ||
      row.drawOrder >= row.observationOrder ||
      (previous && row.observationOrder <= previous.observationOrder)
    )
      throw Error(
        "Display observation orders must follow their draws and increase",
      );
    add(row, "tick", row.observationOrder, row.wallTime);
    previous = row;
  }
  if (boundary) {
    if (
      (frames.length && boundary.drawOrder >= frames[0].drawOrder) ||
      (ticks.length && boundary.drawOrder >= ticks[0].observationOrder)
    )
      throw Error("Initial draw completion must precede recorded observations");
    add(boundary, "draw", boundary.drawOrder, boundary.drawWallTime);
  }
  events.sort((a, b) => a.order - b.order);
  let last = null,
    completed = null;
  for (const event of events) {
    if (last && (event.order === last.order || event.wallTime < last.wallTime))
      throw Error(
        "Unique observation orders and nondecreasing browser samples required",
      );
    if (event.kind === "draw") completed = event.row;
    else if (
      !completed ||
      completed.drawId !== event.row.drawId ||
      completed.drawOrder !== event.row.drawOrder
    )
      throw Error(
        "Display observation must identify the latest completed draw",
      );
    last = event;
  }
}

// Timestamp-only historical recordings cannot identify one of multiple draws
// with the same coarsened sample. Preserve that ambiguity rather than taking
// the final Map entry or guessing from replay time/configuration metadata.
export function createDiagnosticFrameLookup(frames, identified) {
  const byId = new Map(),
    byTime = new Map();
  for (const row of frames) {
    if (identified) {
      if (!positive(row.drawId) || byId.has(row.drawId))
        throw Error("Unique positive diagnostic draw identities required");
      byId.set(row.drawId, row);
    } else {
      const group = byTime.get(row.wallTime) ?? [];
      group.push(row);
      byTime.set(row.wallTime, group);
    }
  }
  return (sample) => {
    if (identified)
      return { frame: byId.get(sample.drawId) ?? null, ambiguous: false };
    const group = byTime.get(sample.wallTime);
    return {
      frame: group?.length === 1 ? group[0] : null,
      ambiguous: (group?.length ?? 0) > 1,
    };
  };
}
