const choices = new WeakMap(),
  f = Math.fround;

// Translation of 16.21 original SelectorClip activation1591bd1..1591cba.
// The supplied stream uses original nextFloat1490eb0; its client startup seed
// comes from mach_absolute_time through665bf4..665c01 and14910e0 (zero→one).
export function selectLatestAnimationWeightedPair(pairs, randomValue) {
  if (
    !Array.isArray(pairs) ||
    !pairs.length ||
    pairs.length > 1024 ||
    typeof randomValue !== "number" ||
    !Number.isFinite(randomValue) ||
    randomValue < 0 ||
    randomValue > 1
  )
    throw Error(
      "Bounded original selector pairs and native unit random value required",
    );
  let sum = f(0);
  for (const pair of pairs) {
    if (
      !pair ||
      typeof pair.mClipName !== "string" ||
      typeof pair.mProbability !== "number" ||
      !Number.isFinite(f(pair.mProbability)) ||
      pair.mProbability < 0
    )
      throw Error("Explicit authored animation selector probability required");
    sum = f(sum + f(pair.mProbability));
  }
  if (!Number.isFinite(sum) || sum <= 0)
    throw Error("Positive finite original selector weight sum required");
  let remaining = f(sum * f(randomValue));
  for (const pair of pairs) {
    remaining = f(remaining - f(pair.mProbability));
    if (remaining <= 0) return pair.mClipName;
  }
  // This is the original prefix's first-child initialization, preserved if
  // float32 accumulation leaves a positive remainder after the final entry.
  return pairs[0].mClipName;
}

export function resolveLatestAnimationSelectorChoice(handle, node) {
  const choice = choices.get(handle);
  if (!choice || choice.node !== node)
    throw Error(
      "Owned activation choice for this original selector node required",
    );
  return choice.name;
}

// A replay owns a local visual stream, distinct from a claim to recover Riot's
// global thread call ordering. Recorded death activations consume its original
// weighted-selection kernel once, in transport order; seeks reuse those choices.
export function bindLatestDeathAnimationChoices(entries, lifecycle, random) {
  if (
    !(lifecycle?.tracks instanceof Map) ||
    typeof random?.next !== "function" ||
    typeof random?.snapshot !== "function"
  )
    throw Error("Original lifecycle and owned native random stream required");
  const activations = [],
    byGraph = new Map(),
    observed = new Set(),
    initialRandom = structuredClone(random.snapshot());
  for (const entry of entries) {
    const node = entry.graph.find("Death")?.value;
    if (node?.__type !== "SelectorClipData") continue;
    if (node.Updater !== undefined)
      throw Error(
        "Death selector updater requires its original state provider",
      );
    const pairs = node.mSelectorPairDataList;
    selectLatestAnimationWeightedPair(pairs, 0);
    for (const pair of pairs) {
      const child = entry.graph.find(pair.mClipName);
      if (child?.value.__type !== "AtomicClipData")
        throw Error(
          "Original selector death child must have an admitted atomic controller",
        );
      const start = entry.graph.evaluate(pair.mClipName, 0, { moving: false });
      if (
        start.unresolved.length ||
        !(start.duration > 0) ||
        start.leaves.length !== 1
      )
        throw Error("Original selector death child pose is unresolved");
    }
    for (const interval of lifecycle.tracks.get(entry.event.entityId) ?? []) {
      const death = interval.death;
      if (
        !Number.isSafeInteger(death.transportSequence) ||
        death.transportSequence < 0 ||
        !Number.isSafeInteger(death.sequence) ||
        death.sequence < 0 ||
        observed.has(death.sequence)
      )
        throw Error("Distinct original death transport identities required");
      observed.add(death.sequence);
      activations.push({ graph: entry.graph, node, death });
    }
  }
  activations.sort(
    (a, b) =>
      a.death.transportSequence - b.death.transportSequence ||
      a.death.sequence - b.death.sequence,
  );
  for (const { graph, node, death } of activations) {
    const name = selectLatestAnimationWeightedPair(
        node.mSelectorPairDataList,
        random.next(),
      ),
      handle = Object.freeze({});
    choices.set(handle, { node, name, death });
    if (!byGraph.has(graph)) byGraph.set(graph, new Map());
    byGraph.get(graph).set(death.sequence, handle);
  }
  const finalRandom = structuredClone(random.snapshot());
  const activationCount = activations.length;
  activations.length = 0;
  let closed = false;
  return {
    forDeath(graph, life) {
      if (closed) throw Error("Closed replay animation selector owner");
      if (
        !life.dead ||
        graph.find("Death")?.value.__type !== "SelectorClipData"
      )
        return undefined;
      const handle = byGraph.get(graph)?.get(life.interval.death.sequence),
        choice = choices.get(handle);
      if (!choice || choice.death !== life.interval.death)
        throw Error(
          "Recorded death lacks its owned animation selector activation",
        );
      return handle;
    },
    diagnostics: () => ({
      activations: activationCount,
      graphs: byGraph.size,
      initialRandom: structuredClone(initialRandom),
      finalRandom: structuredClone(finalRandom),
      scope:
        "Owned local visual RNG and recorded death order; original global client RNG call ordering is not recovered",
    }),
    close() {
      closed = true;
      for (const rows of byGraph.values())
        for (const handle of rows.values()) choices.delete(handle);
      byGraph.clear();
    },
  };
}
