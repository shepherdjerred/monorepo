import { Fragment, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type Permission,
  type PermissionSet,
  type Role,
  ALL_PERMISSIONS,
  ROLES,
  canDelegateRole,
  permissionKey,
  permissionsForRole,
} from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import { Button } from "#src/components/ui/button.tsx";
import { Badge } from "#src/components/ui/badge.tsx";
import {
  missingPermissionFromError,
  permissionLabel,
} from "#src/components/forbidden-panel.tsx";
import { DiscordMemberCombobox } from "#src/components/discord-member-combobox.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#src/components/ui/select.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#src/components/ui/table.tsx";

function roleLabel(role: Role | "custom"): string {
  if (role === "custom") return "Custom";
  return ROLES.find((r) => r.id === role)?.label ?? role;
}

type RoleSelection = Role | "custom";

function parseRoleSelection(value: string): RoleSelection | null {
  if (value === "custom") return value;
  return ROLES.find((role) => role.id === value)?.id ?? null;
}

function canDelegateSelection(
  permissions: PermissionSet,
  selection: RoleSelection,
  customPermissions: readonly Permission[],
): boolean {
  if (selection === "custom") return customPermissions.length > 0;
  return canDelegateRole(permissions, selection);
}

function PermissionChecklist(props: {
  idPrefix: string;
  selected: readonly Permission[];
  canAdd: (permission: Permission) => boolean;
  canRemoveSelected: boolean;
  onChange: (permissions: Permission[]) => void;
}) {
  const selectedKeys = new Set(
    props.selected.map((permission) => permissionKey(permission)),
  );

  return (
    <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
      {ALL_PERMISSIONS.map((permission) => {
        const key = permissionKey(permission);
        const inputId = `${props.idPrefix}-${key}`;
        const checked = selectedKeys.has(key);
        const disabled = checked
          ? !props.canRemoveSelected
          : !props.canAdd(permission);
        return (
          <div
            key={key}
            className="flex items-start gap-2 text-sm text-muted-foreground"
          >
            <input
              id={inputId}
              type="checkbox"
              className="mt-1"
              checked={checked}
              disabled={disabled}
              onChange={(event) => {
                if (event.currentTarget.checked) {
                  props.onChange([...props.selected, permission]);
                  return;
                }
                props.onChange(
                  props.selected.filter(
                    (candidate) => permissionKey(candidate) !== key,
                  ),
                );
              }}
            />
            <label htmlFor={inputId}>
              <span className="block text-foreground">
                {permissionLabel(permission)}
              </span>
              <span className="font-mono text-xs">{key}</span>
            </label>
          </div>
        );
      })}
    </div>
  );
}

export function GuildAccess() {
  const { guildId } = useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const safeGuildId = guildId ?? "";
  const { perms } = usePermissions(guildId);
  const canGrant = perms.can("roles", "grant");
  const canRevoke = perms.can("roles", "revoke");

  const listKey = trpc.roles.list.queryKey({ guildId: safeGuildId });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: listKey }),
      queryClient.invalidateQueries({
        queryKey: trpc.guild.listManageable.pathKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.guild.myPermissions.pathKey(),
      }),
    ]);
  };

  const rolesQuery = useQuery(
    trpc.roles.list.queryOptions(
      { guildId: safeGuildId },
      { enabled: guildId !== undefined },
    ),
  );
  const setMutation = useMutation(
    trpc.roles.set.mutationOptions({ onSuccess: invalidate }),
  );
  const clearMutation = useMutation(
    trpc.roles.clear.mutationOptions({ onSuccess: invalidate }),
  );

  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState<RoleSelection>("viewer");
  const [newCustomPermissions, setNewCustomPermissions] = useState<
    Permission[]
  >([]);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<Permission[]>(
    [],
  );

  if (guildId === undefined) {
    return <p className="text-sm text-destructive">Missing guild id</p>;
  }

  const members = rolesQuery.data ?? [];
  const mutationError = setMutation.error ?? clearMutation.error;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Access</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Grant members scoped access to this server. Discord admins always have
          full access and aren&apos;t listed here.
        </p>
      </div>

      {canGrant && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
          <div className="min-w-[16rem] flex-1 space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">
              Member
            </span>
            <DiscordMemberCombobox
              guildId={guildId}
              value={newUserId}
              onChange={setNewUserId}
            />
          </div>
          <div className="space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">
              Role
            </span>
            <Select
              value={newRole}
              onValueChange={(value) => {
                const selection = parseRoleSelection(value);
                if (selection !== null) setNewRole(selection);
              }}
            >
              <SelectTrigger aria-label="Role" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((role) => (
                  <SelectItem
                    key={role.id}
                    value={role.id}
                    disabled={!canDelegateRole(perms, role.id)}
                  >
                    {role.label}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={
              newUserId.length === 0 ||
              setMutation.isPending ||
              !canDelegateSelection(perms, newRole, newCustomPermissions)
            }
            onClick={() => {
              setMutation.mutate(
                {
                  guildId,
                  discordUserId: newUserId,
                  permissions:
                    newRole === "custom"
                      ? newCustomPermissions
                      : permissionsForRole(newRole),
                },
                {
                  onSuccess: () => {
                    setNewUserId("");
                    setNewRole("viewer");
                    setNewCustomPermissions([]);
                  },
                },
              );
            }}
          >
            Add member
          </Button>
          {newRole === "custom" && (
            <div className="w-full space-y-2">
              <p className="text-sm font-medium">Custom permissions</p>
              <PermissionChecklist
                idPrefix="new-member-permission"
                selected={newCustomPermissions}
                canAdd={(permission) =>
                  perms.can(permission.resource, permission.action)
                }
                canRemoveSelected
                onChange={setNewCustomPermissions}
              />
            </div>
          )}
        </div>
      )}

      {mutationError &&
        (() => {
          const missing = missingPermissionFromError(mutationError);
          return (
            <p className="text-sm text-destructive">
              {missing
                ? `You need "${permissionLabel(missing)}" to do that.`
                : mutationError.message}
            </p>
          );
        })()}
      {rolesQuery.error && (
        <p className="text-sm text-destructive">
          Failed to load: {rolesQuery.error.message}
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Permissions</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="text-center text-sm text-muted-foreground"
              >
                No members have been granted access yet.
              </TableCell>
            </TableRow>
          ) : (
            members.map((member) => (
              <Fragment key={member.discordUserId}>
                <TableRow>
                  <TableCell className="flex items-center gap-2">
                    {member.avatar !== null && (
                      <img
                        src={member.avatar}
                        alt=""
                        width={20}
                        height={20}
                        className="h-5 w-5 rounded-full"
                      />
                    )}
                    <span className="truncate">{member.username}</span>
                  </TableCell>
                  <TableCell>
                    {canGrant ? (
                      <div className="flex items-center gap-2">
                        <Select
                          value={member.role}
                          onValueChange={(value) => {
                            const selection = parseRoleSelection(value);
                            if (selection === null) return;
                            if (selection === "custom") {
                              setEditingUserId(member.discordUserId);
                              setEditingPermissions(member.permissions);
                              return;
                            }
                            setEditingUserId(null);
                            setMutation.mutate({
                              guildId,
                              discordUserId: member.discordUserId,
                              permissions: permissionsForRole(selection),
                            });
                          }}
                        >
                          <SelectTrigger
                            aria-label="Change role"
                            className="w-36"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map((role) => (
                              <SelectItem
                                key={role.id}
                                value={role.id}
                                disabled={!canDelegateRole(perms, role.id)}
                              >
                                {role.label}
                              </SelectItem>
                            ))}
                            <SelectItem value="custom">Custom</SelectItem>
                          </SelectContent>
                        </Select>
                        {member.role === "custom" && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingUserId(member.discordUserId);
                              setEditingPermissions(member.permissions);
                            }}
                          >
                            Edit
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Badge>{roleLabel(member.role)}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <span>{member.permissions.length}</span>
                    {member.role === "custom" && (
                      <span className="mt-1 block max-w-md text-xs">
                        {member.permissions
                          .map((permission) => permissionLabel(permission))
                          .join(", ")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {canRevoke && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={clearMutation.isPending}
                        onClick={() => {
                          clearMutation.mutate({
                            guildId,
                            discordUserId: member.discordUserId,
                          });
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                {canGrant && editingUserId === member.discordUserId && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <div className="space-y-3">
                        <p className="text-sm font-medium">
                          Custom permissions for {member.username}
                        </p>
                        <PermissionChecklist
                          idPrefix={`member-${member.discordUserId}-permission`}
                          selected={editingPermissions}
                          canAdd={(permission) =>
                            perms.can(permission.resource, permission.action)
                          }
                          canRemoveSelected={canRevoke}
                          onChange={setEditingPermissions}
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingUserId(null);
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={setMutation.isPending}
                            onClick={() => {
                              setMutation.mutate(
                                {
                                  guildId,
                                  discordUserId: member.discordUserId,
                                  permissions: editingPermissions,
                                },
                                {
                                  onSuccess: () => {
                                    setEditingUserId(null);
                                  },
                                },
                              );
                            }}
                          >
                            Save custom
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
