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
import { ApiError, queryClient, readApi, writeApi } from "#client/api.ts";

export function readTarget(mediaId: string): Promise<DefaultTargetView> {
  return readApi(
    `/media/${encodeURIComponent(mediaId)}/targets/default`,
    DefaultTargetViewSchema,
    2,
  );
}

export function useTarget(mediaId: string | undefined) {
  return useQuery({
    queryKey: ["target", mediaId],
    enabled: mediaId !== undefined,
    queryFn: () => readTarget(String(mediaId)),
    refetchInterval: 15_000,
  });
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
    queryClient.invalidateQueries({ queryKey: ["requests"] }),
    queryClient.invalidateQueries({ queryKey: ["removals"] }),
    queryClient.invalidateQueries({ queryKey: ["activity"] }),
  ]);
}
