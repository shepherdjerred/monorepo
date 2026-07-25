import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Role, ROLES, permissionsForRole } from "@scout-for-lol/data";
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

export function GuildAccess() {
  const { guildId } = useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const safeGuildId = guildId ?? "";
  const { perms } = usePermissions(guildId);
  const canGrant = perms.can("roles", "grant");
  const canRevoke = perms.can("roles", "revoke");

  const listKey = trpc.roles.list.queryKey({ guildId: safeGuildId });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: listKey });
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
  const [newRole, setNewRole] = useState<Role>("viewer");

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
                const match = ROLES.find((r) => r.id === value);
                if (match) setNewRole(match.id);
              }}
            >
              <SelectTrigger aria-label="Role" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={newUserId.length === 0 || setMutation.isPending}
            onClick={() => {
              setMutation.mutate(
                {
                  guildId,
                  discordUserId: newUserId,
                  permissions: permissionsForRole(newRole),
                },
                {
                  onSuccess: () => {
                    setNewUserId("");
                    setNewRole("viewer");
                  },
                },
              );
            }}
          >
            Add member
          </Button>
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
              <TableRow key={member.discordUserId}>
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
                  {canGrant && member.role !== "custom" ? (
                    <Select
                      value={member.role}
                      onValueChange={(value) => {
                        const match = ROLES.find((r) => r.id === value);
                        if (!match) return;
                        setMutation.mutate({
                          guildId,
                          discordUserId: member.discordUserId,
                          permissions: permissionsForRole(match.id),
                        });
                      }}
                    >
                      <SelectTrigger aria-label="Change role" className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            {role.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge>{roleLabel(member.role)}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {member.permissions.length}
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
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
