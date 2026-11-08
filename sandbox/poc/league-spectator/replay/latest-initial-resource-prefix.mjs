import { sha256 } from "./structural-comparison.mjs";
import {
  createLatestEffectContexts,
  nativeCharacterEffectContextIdentity,
  EFFECT_CONTEXTS_PACKAGE_SHA,
  isLatestEffectContexts,
} from "./latest-effect-contexts.mjs";
import {
  createLatestEffectResolvers,
  EFFECT_RESOLVERS_PACKAGE_SHA,
  isLatestEffectResolvers,
} from "./latest-effect-resolvers.mjs";
import { createLatestResourceRequestTrack } from "./latest-resource-requests.mjs";
import { INITIAL_RESOURCE_PREFIX_PACKAGE_SHA } from "./latest-initial-resource-prefix-contract.mjs";
import {
  createLatestNegativeFormPrefix,
  isLatestNegativeFormPrefix,
} from "./latest-negative-form-prefix.mjs";
import {
  assertSelectedFixedResourceProgram,
  assertSelectedResourceDependency,
} from "./latest-selected-resource-programs.mjs";

export const INITIAL_RESOURCE_PREFIX_POLICY =
  "native-initial-resource-presentation-prefix-v1";
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const ordinal = (value) => Number.isSafeInteger(value) && value >= 0;
const frozen = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
};
const compare = (a, b) =>
  a.time - b.time ||
  a.transportSequence - b.transportSequence ||
  a.entryOrder - b.entryOrder;
const clock = (time, cursor) => {
  if (
    !Number.isFinite(time) ||
    time < 0 ||
    (cursor !== null &&
      (!ordinal(cursor?.transportSequence) ||
        !ordinal(cursor.entryOrder) ||
        (cursor.exclusive !== undefined &&
          typeof cursor.exclusive !== "boolean")))
  )
    throw Error("Initial resource presentation query requires a causal clock");
};
const before = (event, time, cursor) =>
  event.time < time ||
  (event.time === time &&
    (cursor === null ||
      (cursor.exclusive
        ? compare(event, { time, ...cursor }) < 0
        : compare(event, { time, ...cursor }) <= 0)));

// A declared presentation input, separate from accepted resource observations.
// Exact decoded initial identity selects a statically loaded authored resolver.
// No failed native lookup is retried through this policy.
export async function createLatestInitialResourcePrefix({
  profile,
  packageBytes,
  contexts,
  resolvers,
  report,
  negativeFormPrefix = null,
  staticCatalog = null,
}) {
  if (
    negativeFormPrefix !== null &&
    !isLatestNegativeFormPrefix(negativeFormPrefix)
  )
    throw Error("Owned negative-form conditional-prefix policy required");
  if ((await sha256(packageBytes)) !== INITIAL_RESOURCE_PREFIX_PACKAGE_SHA)
    throw Error("Pinned initial resource presentation prefix package required");
  if (staticCatalog !== null) {
    if (
      !isLatestEffectContexts(contexts) ||
      !isLatestEffectResolvers(resolvers)
    )
      throw Error("Owned selected context/resolver required by initial prefix");
    await assertSelectedFixedResourceProgram({
      selection: staticCatalog,
      profile,
      role: "initialResourcePrefix",
      packageBytes,
    });
    await assertSelectedResourceDependency(
      staticCatalog,
      "effectContexts",
      contexts.metadata,
    );
    await assertSelectedResourceDependency(
      staticCatalog,
      "effectResolvers",
      resolvers.metadata,
    );
  }
  const metadata = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  const scope = metadata.scope;
  if (
    metadata.schema !== 1 ||
    metadata.kind !== "prepared-initial-resource-presentation-prefix" ||
    metadata.policy !== INITIAL_RESOURCE_PREFIX_POLICY ||
    metadata.build !== "16.21.829.8620" ||
    metadata.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== metadata.build ||
    profile.protocolDigest !== metadata.protocol ||
    profile.decoderImageSha256 !== metadata.decoderImageSha256 ||
    report?.build !== metadata.build ||
    report.protocol !== metadata.protocol ||
    metadata.contextsPackageSha256 !== EFFECT_CONTEXTS_PACKAGE_SHA ||
    metadata.resolversPackageSha256 !== EFFECT_RESOLVERS_PACKAGE_SHA ||
    contexts.metadata.build !== metadata.build ||
    resolvers.metadata.build !== metadata.build ||
    !scope?.staticBuildDataOnly ||
    scope.containsReplayEvents ||
    scope.containsUnitInstances ||
    !scope.original1049ArgumentBridge ||
    !scope.defaultStoragePrefix ||
    !scope.baseCallbackPrefix ||
    !scope.constructorEmptyOverlays ||
    scope.assetReadinessRecovered ||
    scope.nativeWorldAcceptanceRecovered
  )
    throw Error("Unsupported initial resource presentation prefix contract");
  if (!Array.isArray(report.heroes) || !Array.isArray(report.resourceRequests))
    throw Error(
      "Decoded hero identities and explicit resource request inventory required",
    );
  const requests = createLatestResourceRequestTrack(
    report.resourceRequests,
  ).records;
  const heroes = new Map();
  for (const hero of report.heroes) {
    if (
      !uint(hero.entityId) ||
      hero.entityId === 0 ||
      heroes.has(hero.entityId)
    )
      throw Error(
        "Unique decoded hero identity required by initial resource presentation",
      );
    heroes.set(hero.entityId, structuredClone(hero));
  }
  const requestsByEntity = new Map(),
    states = new Map();
  for (const request of requests) {
    if (!requestsByEntity.has(request.entityId))
      requestsByEntity.set(request.entityId, []);
    requestsByEntity.get(request.entityId).push(request);
  }
  const bindings = new Map();
  for (const context of contexts.metadata.contexts) {
    const resolver = resolvers.metadata.actors.find(
      (actor) => actor.contextIdentity === context.identity,
    );
    if (!resolver || bindings.has(context.identity))
      throw Error("Complete unique static resource binding required");
    bindings.set(context.identity, structuredClone({ context, resolver }));
  }
  const omissions = Object.freeze([
    "resource:native-appearance-cache-acquisition-unrecovered",
    "resource:native-asset-readiness-unrecovered",
    "resource:native-network-unit-acceptance-unrecovered",
    "resource:later-appearance-form-producers-not-translated",
    "resource:global-fallback-and-external-vfx-linking-unrecovered",
  ]);
  const evidence = frozen({
    policy: INITIAL_RESOURCE_PREFIX_POLICY,
    nativeAcceptance: null,
    nativeCacheReadiness: null,
    liveEngineResourceState: null,
    browserStaticPackageReady: true,
    omissions: [...omissions],
  });
  return Object.freeze({
    metadata: frozen(structuredClone(metadata)),
    negativeFormPrefix,
    query(entityId, time, cursor = null) {
      if (!uint(entityId) || entityId === 0)
        throw Error("Unsigned resource presentation entity required");
      clock(time, cursor);
      const hero = heroes.get(entityId),
        p = hero?.provenance;
      const unresolved = (reason, extra = {}) =>
        frozen({
          ...evidence,
          status: "unresolved-initial-resource-presentation",
          stack: null,
          reasons: [reason],
          ...extra,
        });
      if (
        !hero ||
        hero.kind !== "hero-creation-candidate" ||
        p?.time !== 0 ||
        p.stream !== 2 ||
        !ordinal(p.chunkId) ||
        !ordinal(p.transportSequence) ||
        !ordinal(p.entryOrder ?? 0) ||
        typeof hero.champion !== "string" ||
        !hero.champion.length ||
        !uint(hero.skinId)
      )
        return unresolved("resource:initial-1049-identity-prefix-unproven");
      const creation = {
        time: 0,
        transportSequence: p.transportSequence,
        entryOrder: p.entryOrder ?? 0,
      };
      const sourceEventId = `hero-creation:${entityId}:${p.transportSequence}:${creation.entryOrder}`;
      if (!before(creation, time, cursor))
        return unresolved("resource:initial-1049-prefix-not-yet-created", {
          sourceEventId,
        });
      // A proved negative-form observation can preserve this initial prefix.
      // It never restores/renews state after an unknown request invalidates it.
      // Snapshot provenance and its unimplemented restoration remain visible.
      let state = states.get(entityId);
      if (!state) {
        const afterCreation = (requestsByEntity.get(entityId) ?? []).filter(
            (event) => compare(event, creation) > 0,
          ),
          observations = new Map(
            afterCreation.map((event) => [
              event.id,
              negativeFormPrefix?.classify(hero, event) ?? null,
            ]),
          );
        state = {
          firstMutation: afterCreation.find(
            (event) => !observations.get(event.id),
          ),
          preserved: afterCreation
            .map((event) => observations.get(event.id))
            .filter(Boolean),
          versions: new Map(),
          prefix: null,
          invalidated: null,
        };
        states.set(entityId, state);
      }
      const blocker = state.firstMutation;
      if (blocker && before(blocker, time, cursor))
        return (state.invalidated ??= unresolved(
          "resource:untranslated-appearance-or-form-request",
          {
            sourceEventId,
            blockingRequest: structuredClone(blocker),
          },
        ));
      // Each immutable generation has only this static conditional stack and
      // its first invalidation. Query clocks select between them; they never
      // rewrite either state, so backward/exclusive queries remain absolute.
      const prefixAtClock = () => {
        let count = 0;
        while (
          count < state.preserved.length &&
          before(state.preserved[count].request, time, cursor)
        )
          count++;
        if (!count) return state.prefix;
        if (!state.versions.has(count))
          state.versions.set(
            count,
            frozen({
              ...state.prefix,
              prefixPreservingRequestObservations: state.preserved.slice(
                0,
                count,
              ),
              omissions: [
                ...new Set([
                  ...state.prefix.omissions,
                  ...state.preserved
                    .slice(0, count)
                    .flatMap((o) => o.omissions),
                ]),
              ],
            }),
          );
        return state.versions.get(count);
      };
      if (state.prefix) return prefixAtClock();
      const identity = nativeCharacterEffectContextIdentity(
        hero.champion,
        hero.skinId,
        "characters",
      );
      const binding = bindings.get(identity);
      if (
        !binding ||
        binding.context.name !== hero.champion ||
        binding.context.skinId !== hero.skinId
      )
        return (state.prefix = unresolved(
          "resource:initial-static-context-unprepared",
          { sourceEventId },
        ));
      if (binding.resolver.status !== "native-resource-map-loaded")
        return (state.prefix = unresolved(
          "resource:initial-authored-resolver-unprepared",
          { sourceEventId, contextIdentity: identity },
        ));
      state.prefix = frozen({
        ...evidence,
        status: "initial-resource-presentation-stack",
        sourceEventId,
        source: { entityId, ...creation, stream: 2, chunkId: p.chunkId },
        actorKey: binding.context.actorKey,
        contextIdentity: identity,
        resolverDefinitionId: binding.resolver.resourceResolverId,
        stack: {
          status: "supplied-resource-stack",
          base: {
            id: `initial-presentation:${entityId}:${p.transportSequence}:${creation.entryOrder}`,
            contextIdentity: identity,
          },
          overlays: [],
        },
        reasons: [],
        prefixPreservingRequestObservations: [],
      });
      return prefixAtClock();
    },
  });
}

export const INITIAL_RESOURCE_STATIC_PACKAGES = Object.freeze({
  initialResourcePrefix: "latest-initial-resource-prefix/package.json",
  negativeFormPrefix: "latest-negative-form-prefix/package.json",
  effectContexts: "latest-effect-contexts/package.json",
  effectResolvers: "latest-effect-resolvers/package.json",
  builtinResourceContexts: "latest-builtin-resource-contexts/package.json",
});

export async function loadLatestInitialResourcePrefix({
  profile,
  load,
  manifestBytes,
  report,
  staticCatalog = null,
}) {
  if (staticCatalog !== null) load = (path) => staticCatalog.read(path);
  const packages = Object.fromEntries(
    await Promise.all(
      Object.entries(INITIAL_RESOURCE_STATIC_PACKAGES).map(
        async ([key, path]) => [key, await load(path)],
      ),
    ),
  );
  const contexts = await createLatestEffectContexts({
    profile,
    packageBytes: packages.effectContexts,
    effectsManifestBytes: manifestBytes,
    ...(staticCatalog === null
      ? {}
      : {
          staticCatalog,
        }),
  });
  const resolvers = await createLatestEffectResolvers({
    profile,
    contexts,
    packageBytes: packages.effectResolvers,
    effectsManifestBytes: manifestBytes,
    builtinContextPackageBytes: packages.builtinResourceContexts,
    staticCatalog,
  });
  const policy = await createLatestInitialResourcePrefix({
    profile,
    report,
    contexts,
    resolvers,
    packageBytes: packages.initialResourcePrefix,
    staticCatalog,
    negativeFormPrefix: await createLatestNegativeFormPrefix({
      profile,
      packageBytes: packages.negativeFormPrefix,
      effectsManifestBytes: manifestBytes,
      staticCatalog,
    }),
  });
  return {
    policy,
    packages: { ...packages, effectsManifest: manifestBytes },
    contexts,
    resolvers,
  };
}
