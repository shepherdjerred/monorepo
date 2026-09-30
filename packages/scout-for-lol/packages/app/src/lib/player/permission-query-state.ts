export type QueryStatus = "pending" | "success" | "error";
export type QueryError = { message: string };

export function shouldQueryScopedPermissions(params: {
  guildId: string | undefined;
  listStatus: QueryStatus;
  hasListEntry: boolean;
}): boolean {
  return (
    params.guildId !== undefined &&
    (params.listStatus === "error" ||
      (params.listStatus === "success" && !params.hasListEntry))
  );
}

export function resolvePermissionQueryError(params: {
  hasListEntry: boolean;
  fallbackSucceeded: boolean;
  listError: QueryError | null;
  fallbackError: QueryError | null;
}): QueryError | null {
  return params.hasListEntry || params.fallbackSucceeded
    ? null
    : (params.fallbackError ?? params.listError);
}
