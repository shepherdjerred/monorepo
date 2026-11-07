import { compileDirectEmitterLifecycle } from "./latest-direct-effect-lifecycle.mjs";
const f = Math.fround;
// Original emitter materialOverrideDefinitions vector+20 feeds link+78/count80
// through16e9779..9794 ->16e99f0. An empty source never enters the allocator or
// resource constructor. This does not recover nonempty override acceptance.
export function directEmptyLinkControllerCount(source) {
  if (!source || typeof source !== "object" || Array.isArray(source))
    return null;
  if (
    "materialOverrideDefinitions" in source &&
    !Object.hasOwn(source, "materialOverrideDefinitions")
  )
    return null;
  if (!Object.hasOwn(source, "materialOverrideDefinitions")) return 0;
  const entries = source.materialOverrideDefinitions;
  return Array.isArray(entries) &&
    entries.length === 0 &&
    Object.getOwnPropertyNames(entries).length === 1
    ? 0
    : null;
}

// Original16e17e6..1860, following timer calculation and preceding actor
// construction. The resource virtual+30 result is an explicit input here.
export function directSingleResourceLifetime({
  lifetime,
  particleLifetimeMaximum,
  isSingleParticle,
  materialOverrideCount,
}) {
  if (
    ![lifetime, particleLifetimeMaximum].every(
      (v) => Number.isFinite(v) && Number.isFinite(f(v)),
    ) ||
    typeof isSingleParticle !== "boolean" ||
    !Number.isInteger(materialOverrideCount) ||
    materialOverrideCount < 0 ||
    materialOverrideCount > 0xffffffff
  )
    throw Error(
      "Explicit typed single-particle resource clock inputs required",
    );
  lifetime = f(lifetime);
  particleLifetimeMaximum = f(particleLifetimeMaximum);
  const threshold = f(particleLifetimeMaximum + f(10));
  const rewritten =
    isSingleParticle &&
    materialOverrideCount === 0 &&
    particleLifetimeMaximum !== -1 &&
    lifetime > threshold;
  return {
    sourceLifetime: lifetime,
    effectiveLifetime: rewritten ? particleLifetimeMaximum : lifetime,
    particleLifetimeMaximum,
    threshold,
    rewritten,
  };
}

// The original link timers are calculated BEFORE this rewrite. Keep the
// lifecycle candidate's linkTimers, and use effectiveLifetime for actor clocks
// and emitter-age normalization; never mutate the authored source definition.
export function compileDirectEmptySingleResourceProgram(source, primitive) {
  const lifecycle = compileDirectEmitterLifecycle(source, primitive);
  const linkControllerCount = directEmptyLinkControllerCount(source);
  if (!lifecycle?.requiresLinkControllerCount || linkControllerCount !== 0)
    return null;
  return {
    policy: "native-empty-material-overrides-single-clock-v1",
    linkControllerCount,
    ...directSingleResourceLifetime({
      lifetime: lifecycle.lifetime,
      particleLifetimeMaximum: lifecycle.particleLifetime,
      isSingleParticle: true,
      materialOverrideCount: 0,
    }),
  };
}
