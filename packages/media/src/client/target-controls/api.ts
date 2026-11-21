import { useQuery } from "@tanstack/react-query";
import {
  DefaultCommandResultV2Schema,
  DefaultCommandV2Schema,
  type DefaultCommandV2,
} from "#shared/editions/commands.ts";
import {
  DefaultTargetViewSchema,
  type DefaultTargetView,
} from "#shared/editions/target-view.ts";
import {
  DEFAULT_TARGET_BATCH_LIMIT,
  DefaultTargetBatchSchema,
  batchAnswers,
} from "#shared/editions/target-batch.ts";
import {
  ApiError,
  queryClient,
  readApi,
  sessionBoundary,
  writeApi,
} from "#client/api.ts";

export function readTarget(mediaId: string): Promise<DefaultTargetView> {
  return readApi(
    `/media/${encodeURIComponent(mediaId)}/targets/default`,
    DefaultTargetViewSchema,
    2,
  );
}

/** With `enabled` false this only watches the key, which a list fills for
 * its own rows. */
export function useTarget(mediaId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["target", mediaId],
    enabled: enabled && mediaId !== undefined,
    queryFn: () => readTarget(String(mediaId)),
    refetchInterval: 15_000,
  });
}

function readTargetBatch(mediaIds: readonly string[]) {
  return readApi(
    `/targets/default?ids=${mediaIds.join(",")}`,
    DefaultTargetBatchSchema.refine(
      (batch) => batchAnswers(batch, mediaIds),
      "Batch response does not match the requested titles",
    ),
    2,
  );
}

/** Reads a list's titles in one request per 50 and writes each view to the
 * key `useTarget` reads, so a row needs no request of its own. Returns the
 * titles the actor has no view of. */
export async function readListedTargets(
  mediaIds: readonly string[],
  signal: AbortSignal,
) {
  const session = sessionBoundary.capture();
  const pages: string[][] = [];
  for (
    let start = 0;
    start < mediaIds.length;
    start += DEFAULT_TARGET_BATCH_LIMIT
  )
    pages.push(mediaIds.slice(start, start + DEFAULT_TARGET_BATCH_LIMIT));
  const batches = await Promise.all(pages.map((ids) => readTargetBatch(ids)));
  // Neither a retired session nor a superseded read may write these views.
  session.assertCurrent();
  signal.throwIfAborted();
  const items = batches.flatMap((batch) => batch.items);
  for (const item of items)
    if (item.status === "ok")
      queryClient.setQueryData(["target", item.view.scope.mediaId], item.view);
  return items.flatMap((item) => (item.status === "ok" ? [] : [item]));
}

export function targetCommand(
  context: DefaultTargetView,
  command: DefaultCommandV2["command"],
): DefaultCommandV2 {
  const allowed: readonly string[] = context.allowedProtectiveActions;
  const protective = allowed.includes(command.action);
  if (!protective && context.access === "protection_only")
    throw new ApiError(
      "protection_only",
      "Library access is required for this action.",
      403,
    );
  return DefaultCommandV2Schema.parse({
    schemaVersion: 2,
    scope: context.scope,
    expected: context.expected,
    command,
  });
}

export function writeTarget(
  actorId: string,
  context: DefaultTargetView,
  command: DefaultCommandV2["command"],
) {
  return writeApi({
    actorId,
    path: `/media/${encodeURIComponent(context.scope.mediaId)}/commands`,
    version: 2,
    body: targetCommand(context, command),
    schema: DefaultCommandResultV2Schema.refine(
      (result) => result.scope.mediaId === context.scope.mediaId,
      "Command response belongs to another title",
    ),
  });
}

export async function invalidateTarget(mediaId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["media", mediaId] }),
    queryClient.invalidateQueries({ queryKey: ["target", mediaId] }),
    queryClient.invalidateQueries({ queryKey: ["targets"] }),
    queryClient.invalidateQueries({ queryKey: ["requests"] }),
    queryClient.invalidateQueries({ queryKey: ["removals"] }),
    queryClient.invalidateQueries({ queryKey: ["activity"] }),
  ]);
}
