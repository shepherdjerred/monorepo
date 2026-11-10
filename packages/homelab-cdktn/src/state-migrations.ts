import type { TerraformResource, TerraformStack } from "cdktn";

type MovedBlock = { from: string; to: string };
type RemovedBlock = { from: string; lifecycle: { destroy: false } };
type Migrations = { moved: MovedBlock[]; removed: RemovedBlock[] };

const migrations = new WeakMap<TerraformStack, Migrations>();

/**
 * cdktn has no construct for `removed` blocks, and a stack-level override
 * replaces whatever is already at its path. Every stack-level `moved` and
 * `removed` block therefore goes through this one list per stack, re-applied
 * whole on each addition.
 */
function migrationsOf(stack: TerraformStack): Migrations {
  const existing = migrations.get(stack);
  if (existing !== undefined) return existing;
  const created: Migrations = { moved: [], removed: [] };
  migrations.set(stack, created);
  return created;
}

/**
 * Records that state address `from` is now `to`. Use it for a move between
 * two addresses that are not both whole resources of this stack, such as
 * `for_each` instances; a renamed construct uses the resource's own
 * `moveFromId`, which this must not be mixed with in one stack.
 */
export function moved(stack: TerraformStack, from: string, to: string): void {
  const { moved: blocks } = migrationsOf(stack);
  blocks.push({ from, to });
  stack.addOverride("moved", blocks);
}

/** Forgets a resource without destroying it (`removed { lifecycle { destroy = false } }`). */
export function forget(stack: TerraformStack, address: string): void {
  const { removed } = migrationsOf(stack);
  removed.push({ from: address, lifecycle: { destroy: false } });
  stack.addOverride("removed", removed);
}

/**
 * Forgets one `for_each` instance without destroying it. `removed` cannot
 * address an instance, so the instance is first moved to a whole-resource
 * address that exists only to be forgotten:
 *
 *     retire(this, {
 *       from: 'docker_hub_repository.image["discord-plays-pokemon"]',
 *       as: "docker_hub_repository.retired_discord_plays_pokemon",
 *     });
 */
export function retire(
  stack: TerraformStack,
  retired: { from: string; as: string },
): void {
  if (!/\[.+\]$/u.test(retired.from))
    throw new Error(
      `${retired.from} is a whole resource: forget() it instead of retiring an instance`,
    );
  if (retired.as.includes("["))
    throw new Error(
      `${retired.as} must be a whole-resource address that removed can forget`,
    );
  moved(stack, retired.from, retired.as);
  forget(stack, retired.as);
}

/**
 * Adopts an object that already exists: imports it at `importId` and refuses
 * any plan that would destroy it. Mirrors the HCL pairing of an `import`
 * block with `lifecycle { prevent_destroy = true }`.
 */
export function adopt<Resource extends TerraformResource>(
  resource: Resource,
  importId: string,
): Resource {
  resource.importFrom(importId);
  protect(resource);
  return resource;
}

/** `lifecycle { prevent_destroy = true }`, keeping any lifecycle the resource already declares. */
export function protect<Resource extends TerraformResource>(
  resource: Resource,
): Resource {
  resource.addOverride("lifecycle.prevent_destroy", true);
  return resource;
}
