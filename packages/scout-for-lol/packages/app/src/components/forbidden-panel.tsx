import { z } from "zod";
import {
  type Permission,
  PERMISSION_CATALOG,
  PermissionSchema,
} from "@scout-for-lol/data";

/** Human label for a permission, from the shared catalog (e.g. "Run & post reports"). */
export function permissionLabel(permission: Permission): string {
  const action = PERMISSION_CATALOG[permission.resource].actions.find(
    (a) => a.name === permission.action,
  );
  return action?.label ?? `${permission.resource}:${permission.action}`;
}

const ErrorWithMissingPermissionSchema = z.object({
  data: z.object({ missingPermission: PermissionSchema }),
});

/**
 * Pull the `{ resource, action }` the server reported as missing from a tRPC
 * client error, if present (set by the backend errorFormatter on FORBIDDEN).
 */
export function missingPermissionFromError(error: unknown): Permission | null {
  const parsed = ErrorWithMissingPermissionSchema.safeParse(error);
  return parsed.success ? parsed.data.data.missingPermission : null;
}

/** A friendly, self-contained "you don't have access" panel. */
export function ForbiddenPanel({
  title = "You don't have access",
  message = "You don't have permission to view this. Ask a server admin for access.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
