import type { PlexItem } from "#integrations/plex.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type {
  PlexBindingFreshness,
  PlexAssociation,
} from "#shared/plex-binding/contract.ts";
import type { BoundMediaCohort } from "./binding.ts";
import { plexRead } from "#automation/publication/association/io.ts";
import {
  projectAssociatedItem,
  associationHash,
} from "#automation/publication/association/projection.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";

/** A complete fresh session response is independent of durable serving identity. */
export async function observeSessionPlayback(
  context: MediaAutomationContext,
  cohort: Pick<BoundMediaCohort, "access"> & {
    original: readonly { association: PlexAssociation }[];
    paths?: readonly string[];
  },
  execution: PlexBindingExecution,
  freshness: PlexBindingFreshness,
) {
  const io = { plex: context.plex, execution, freshness };
  const server = cohort.access[0];
  if (server === undefined)
    throw new Error("Retention session scope omitted configured access");
  const machine = await plexRead(
    io,
    () => context.plex.machineIdentifier(execution.signal),
    "inaccessible",
  );
  if (machine !== server.serverMachineId)
    return { active: true, checkedAt: null };
  const sections = await plexRead(
    io,
    () => context.plex.sections(execution.signal),
    "inaccessible",
  );
  if (
    cohort.access.some(
      (access) =>
        !sections.some(
          (section) =>
            section.key === access.sectionId &&
            section.type === access.sectionType,
        ),
    )
  )
    return { active: true, checkedAt: null };
  const sessions = await plexRead(
    io,
    () => context.plex.activeSessions(execution.signal),
    "inaccessible",
  );
  const checkedAt = new Date().toISOString();
  const keys = new Set(
    cohort.original.map((value) => value.association.item.ratingKey),
  );
  const paths = new Set([
    ...(cohort.paths ?? []),
    ...cohort.original.flatMap((value) => [
      value.association.group.canonicalPath,
      ...value.association.item.media.flatMap((media) =>
        media.parts.map((part) => part.file),
      ),
    ]),
  ]);
  for (const session of sessions) {
    if (keys.has(session.ratingKey)) return { active: true, checkedAt };
    const parts = session.Media?.flatMap((media) => media.Part) ?? [];
    if (
      parts.length === 0 ||
      parts.some(
        (part) =>
          paths.has(part.file) || part.file.includes("/.media-control/"),
      )
    )
      return { active: true, checkedAt };
    if (
      !(await unrelatedSessionIsBound(
        context,
        session,
        {
          serverMachineId: server.serverMachineId,
          access: cohort.access,
        },
        freshness,
      ))
    )
      return { active: true, checkedAt };
  }
  freshness.assertActive();
  return { active: false, checkedAt };
}

export async function retentionPlayback(
  ...args: Parameters<typeof observeSessionPlayback>
) {
  const observation = await observeSessionPlayback(...args);
  return observation.active;
}

async function unrelatedSessionIsBound(
  context: MediaAutomationContext,
  session: PlexItem,
  cohort: Pick<BoundMediaCohort, "access"> & { serverMachineId: string },
  freshness: PlexBindingFreshness,
): Promise<boolean> {
  // A key without a current owned claim cannot establish that an unrelated canonical path is safe.
  const claims = await context.db.plexItemClaim.findMany({
    where: {
      serverMachineId: cohort.serverMachineId,
      ratingKey: session.ratingKey,
    },
    include: { evidence: { select: { assetId: true } } },
    take: 2,
  });
  freshness.assertActive();
  const claim = claims[0];
  if (claim === undefined || claims.length !== 1) return false;
  const access = cohort.access.find(
    (value) => value.sectionId === claim.sectionId,
  );
  if (access === undefined) return false;
  const bound = await readCurrentPlexBinding(context.db, {
    scope: {
      mediaId: claim.mediaId,
      edition: MovieEditionKeySchema.parse(claim.edition),
    },
    assetId: claim.evidence.assetId,
    access,
  });
  freshness.assertActive();
  if (bound.status !== "current") return false;
  try {
    if (
      associationHash(projectAssociatedItem(session, bound.association)) !==
      associationHash(bound.association.item)
    )
      return false;
  } catch (error) {
    if (error instanceof PlexBindingProtection) return false;
    throw error;
  }
  return true;
}
