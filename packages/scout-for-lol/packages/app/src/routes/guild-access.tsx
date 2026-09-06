import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import { StaleState } from "@scout-for-lol/design-system/domain/states";
import { Fragment, useRef, useState } from "react";
import { useSelector } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type Permission,
  type PermissionSet,
  type Role,
  ROLES,
  canDelegateRole,
  permissionsForRole,
} from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { analyticsMeta, track } from "#src/lib/analytics.ts";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import { Button } from "@scout-for-lol/design-system/components/button";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import {
  missingPermissionFromError,
  permissionLabel,
} from "#src/components/forbidden-panel.tsx";
import { DiscordMemberCombobox } from "#src/components/discord-member-combobox.tsx";
import {
  CustomPermissionsForm,
  MemberRoleForm,
  PermissionChecklist,
  type RoleSelection,
} from "#src/components/guild-access-forms.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";
import { STALE_TIME_SLOW_LIST } from "#src/lib/stale-times.ts";
import { useGuildParams } from "#src/lib/route-params.ts";
import {
  fieldErrorMessage,
  focusFirstInvalid,
  FormPendingStatus,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import {
  GuildAccessFormSchema,
  emptyGuildAccessFormValue,
} from "#src/lib/form-schemas.ts";
import {
  Field,
  FieldError,
  Label,
} from "@scout-for-lol/design-system/components/input";

function roleLabel(role: Role | "custom"): string {
  if (role === "custom") return "Custom";
  return ROLES.find((r) => r.id === role)?.label ?? role;
}

function canDelegateSelection(
  permissions: PermissionSet,
  selection: RoleSelection,
  customPermissions: readonly Permission[],
): boolean {
  if (selection === "custom") return customPermissions.length > 0;
  return canDelegateRole(permissions, selection);
}

export function GuildAccess() {
  const { guildId } = useGuildParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { perms } = usePermissions(guildId);
  const canGrant = perms.can("roles", "grant");
  const canRevoke = perms.can("roles", "revoke");

  const listKey = trpc.roles.list.queryKey({ guildId });
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

  const membersValue = Loaded.fromQuery(
    useQuery(
      trpc.roles.list.queryOptions(
        { guildId },
        { staleTime: STALE_TIME_SLOW_LIST },
      ),
    ),
    ["roles.list"],
  );
  // roles.set backs both new grants AND edits (role changes, custom-permission
  // saves, downgrades). A static `meta` would tag every one of those
  // `access_granted`, inflating the grant metric and hiding privilege changes —
  // so this mutation carries no meta and each call site tracks the right event
  // (`access_granted` for a new member, `access_updated` for an edit).
  const setMutation = useMutation(
    trpc.roles.set.mutationOptions({
      onSuccess: invalidate,
    }),
  );
  const clearMutation = useMutation(
    trpc.roles.clear.mutationOptions({
      meta: analyticsMeta("access_revoked"),
      onSuccess: invalidate,
    }),
  );

  const addFormElement = useRef<HTMLFormElement>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const addForm = useScoutForm({
    defaultValues: emptyGuildAccessFormValue(),
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: GuildAccessFormSchema },
    onSubmit: ({ value }) => {
      const parsed = GuildAccessFormSchema.parse(value);
      setMutation.mutate(
        {
          guildId,
          discordUserId: parsed.discordUserId,
          permissions:
            parsed.role === "custom"
              ? parsed.permissions
              : permissionsForRole(parsed.role),
        },
        {
          onSuccess: () => {
            track("access_granted", { outcome: "success" });
            addForm.reset();
          },
          onError: () => {
            track("access_granted", { outcome: "error" });
          },
        },
      );
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(addFormElement.current);
    },
  });
  const newRole = useSelector(addForm.store, (state) => state.values.role);
  const newCustomPermissions = useSelector(
    addForm.store,
    (state) => state.values.permissions,
  );

  const mutationError = setMutation.error ?? clearMutation.error;

  return (
    <LoadingBlock values={{ members: membersValue }}>
      {({ members }, meta) => (
        <>
          <StaleState errors={meta.errors} />
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Access</h2>
              <p className="mt-1 text-sm text-scout-subtle">
                Grant members scoped access to this server. Discord admins
                always have full access and aren&apos;t listed here.
              </p>
            </div>

            {canGrant && (
              <addForm.AppForm>
                <form
                  ref={addFormElement}
                  className="space-y-4 rounded-lg border border-border bg-scout-surface p-4"
                  aria-busy={setMutation.isPending}
                  onSubmit={(event) => {
                    handleFormSubmit(event, () => addForm.handleSubmit());
                  }}
                >
                  <fieldset
                    disabled={setMutation.isPending}
                    className="m-0 space-y-4 border-0 p-0"
                  >
                    <legend className="scout-form-legend">
                      Grant member access
                    </legend>
                    <div className="grid items-end gap-3 sm:grid-cols-[minmax(16rem,1fr)_12rem]">
                      <addForm.AppField name="discordUserId">
                        {(field) => {
                          const error = field.state.meta.isTouched
                            ? fieldErrorMessage(field.state.meta.errors)
                            : undefined;
                          return (
                            <Field>
                              <Label htmlFor="new-access-member">Member</Label>
                              <DiscordMemberCombobox
                                id="new-access-member"
                                name={field.name}
                                guildId={guildId}
                                value={field.state.value}
                                onChange={field.handleChange}
                                required
                                {...(error === undefined
                                  ? {}
                                  : {
                                      ariaInvalid: true,
                                      ariaDescribedBy:
                                        "new-access-member-error",
                                    })}
                              />
                              {error === undefined ? null : (
                                <FieldError id="new-access-member-error">
                                  {error}
                                </FieldError>
                              )}
                            </Field>
                          );
                        }}
                      </addForm.AppField>
                      <addForm.AppField name="role">
                        {(field) => (
                          <field.NativeSelectField
                            id="new-access-role"
                            label="Role"
                            options={[
                              ...ROLES.map((role) => ({
                                value: role.id,
                                label: role.label,
                                disabled: !canDelegateRole(perms, role.id),
                              })),
                              {
                                value: "custom",
                                label: "Custom",
                                disabled: false,
                              },
                            ]}
                            required
                          />
                        )}
                      </addForm.AppField>
                    </div>
                    {newRole === "custom" ? (
                      <addForm.AppField name="permissions">
                        {(field) => {
                          const error = field.state.meta.isTouched
                            ? fieldErrorMessage(field.state.meta.errors)
                            : undefined;
                          return (
                            <Field>
                              <PermissionChecklist
                                idPrefix="new-member-permission"
                                name={field.name}
                                selected={field.state.value}
                                canAdd={(permission) =>
                                  perms.can(
                                    permission.resource,
                                    permission.action,
                                  )
                                }
                                canRemoveSelected
                                onChange={field.handleChange}
                              />
                              {error === undefined ? null : (
                                <FieldError id="new-member-permission-error">
                                  {error}
                                </FieldError>
                              )}
                            </Field>
                          );
                        }}
                      </addForm.AppField>
                    ) : null}
                  </fieldset>
                  <Button
                    type="submit"
                    disabled={
                      setMutation.isPending ||
                      !canDelegateSelection(
                        perms,
                        newRole,
                        newCustomPermissions,
                      )
                    }
                  >
                    {setMutation.isPending ? "Adding…" : "Add member"}
                  </Button>
                  <FormPendingStatus pending={setMutation.isPending}>
                    Granting member access…
                  </FormPendingStatus>
                </form>
              </addForm.AppForm>
            )}

            {mutationError &&
              (() => {
                const missing = missingPermissionFromError(mutationError);
                return (
                  <p className="text-sm text-scout-danger">
                    {missing
                      ? `You need "${permissionLabel(missing)}" to do that.`
                      : mutationError.message}
                  </p>
                );
              })()}
            <Table>
              <caption className="sr-only">Role permissions</caption>
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
                      className="text-center text-sm text-scout-subtle"
                    >
                      No members have been granted access yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  members.map((member) => (
                    <Fragment key={member.discordUserId}>
                      <TableRow>
                        <TableCell>
                          <div className="flex items-center gap-2">
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
                          </div>
                        </TableCell>
                        <TableCell>
                          {canGrant ? (
                            <div className="flex items-center gap-2">
                              <MemberRoleForm
                                id={member.discordUserId}
                                role={member.role}
                                permissions={perms}
                                pending={setMutation.isPending}
                                editingCustomPermissions={
                                  editingUserId === member.discordUserId
                                }
                                onSubmit={(selection) => {
                                  if (selection === "custom") {
                                    setEditingUserId(member.discordUserId);
                                    return;
                                  }
                                  setEditingUserId(null);
                                  setMutation.mutate(
                                    {
                                      guildId,
                                      discordUserId: member.discordUserId,
                                      permissions:
                                        permissionsForRole(selection),
                                    },
                                    {
                                      onSuccess: () => {
                                        track("access_updated", {
                                          outcome: "success",
                                        });
                                      },
                                      onError: () => {
                                        track("access_updated", {
                                          outcome: "error",
                                        });
                                      },
                                    },
                                  );
                                }}
                              />
                              {member.role === "custom" && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setEditingUserId(member.discordUserId);
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
                        <TableCell className="text-sm text-scout-subtle">
                          <span>{member.permissions.length}</span>
                          {member.role === "custom" && (
                            <span className="mt-1 block max-w-md text-xs">
                              {member.permissions
                                .map((permission) =>
                                  permissionLabel(permission),
                                )
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
                            <CustomPermissionsForm
                              id={member.discordUserId}
                              username={member.username}
                              initial={member.permissions}
                              permissions={perms}
                              canRemoveSelected={canRevoke}
                              pending={setMutation.isPending}
                              onCancel={() => {
                                setEditingUserId(null);
                              }}
                              onSubmit={(permissions) => {
                                setMutation.mutate(
                                  {
                                    guildId,
                                    discordUserId: member.discordUserId,
                                    permissions,
                                  },
                                  {
                                    onSuccess: () => {
                                      track("access_updated", {
                                        outcome: "success",
                                      });
                                      setEditingUserId(null);
                                    },
                                    onError: () => {
                                      track("access_updated", {
                                        outcome: "error",
                                      });
                                    },
                                  },
                                );
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </LoadingBlock>
  );
}
