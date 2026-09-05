import { useEffect, useRef } from "react";
import {
  ALL_PERMISSIONS,
  ROLES,
  canDelegateRole,
  permissionKey,
  type Permission,
  type PermissionSet,
  type Role,
} from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Field,
  FieldError,
} from "@scout-for-lol/design-system/components/input";
import { permissionLabel } from "#src/components/forbidden-panel.tsx";
import {
  fieldErrorMessage,
  focusFirstInvalid,
  FormPendingStatus,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import {
  GuildAccessRoleSchema,
  GuildCustomPermissionsSchema,
} from "#src/lib/form-schemas.ts";

export type RoleSelection = Role | "custom";

export function PermissionChecklist(props: {
  idPrefix: string;
  name: string;
  selected: readonly Permission[];
  canAdd: (permission: Permission) => boolean;
  canRemoveSelected: boolean;
  onChange: (permissions: Permission[]) => void;
}) {
  const selectedKeys = new Set(
    props.selected.map((permission) => permissionKey(permission)),
  );

  return (
    <fieldset className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
      <legend className="px-1 text-sm font-medium">Custom permissions</legend>
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
            className="flex items-start gap-2 text-sm text-scout-subtle"
          >
            <input
              id={inputId}
              name={props.name}
              value={key}
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
              <span className="block text-scout-ink">
                {permissionLabel(permission)}
              </span>
              <span className="font-mono text-xs">{key}</span>
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}

export function MemberRoleForm(props: {
  id: string;
  role: RoleSelection;
  permissions: PermissionSet;
  pending: boolean;
  editingCustomPermissions: boolean;
  onSubmit: (role: RoleSelection) => void;
}) {
  const element = useRef<HTMLFormElement>(null);
  const form = useScoutForm({
    defaultValues: { role: props.role },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: GuildAccessRoleSchema },
    onSubmit: ({ value }) => {
      props.onSubmit(GuildAccessRoleSchema.parse(value).role);
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(element.current);
    },
  });

  useEffect(() => {
    if (!props.editingCustomPermissions) {
      form.reset({ role: props.role });
    }
  }, [form, props.editingCustomPermissions, props.role]);

  return (
    <form.AppForm>
      <form
        ref={element}
        className="flex items-end gap-2"
        aria-busy={props.pending}
        onSubmit={(event) => {
          handleFormSubmit(event, () => form.handleSubmit());
        }}
      >
        <form.AppField name="role">
          {(field) => (
            <field.NativeSelectField
              id={`member-role-${props.id}`}
              label={<span className="sr-only">Change role</span>}
              options={[
                ...ROLES.map((role) => ({
                  value: role.id,
                  label: role.label,
                  disabled: !canDelegateRole(props.permissions, role.id),
                })),
                { value: "custom", label: "Custom", disabled: false },
              ]}
              disabled={props.pending}
              required
            />
          )}
        </form.AppField>
        <Button type="submit" size="sm" disabled={props.pending}>
          Apply
        </Button>
      </form>
    </form.AppForm>
  );
}

export function CustomPermissionsForm(props: {
  id: string;
  username: string;
  initial: Permission[];
  permissions: PermissionSet;
  canRemoveSelected: boolean;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (permissions: Permission[]) => void;
}) {
  const element = useRef<HTMLFormElement>(null);
  const form = useScoutForm({
    defaultValues: { permissions: [...props.initial] },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: GuildCustomPermissionsSchema },
    onSubmit: ({ value }) => {
      props.onSubmit(GuildCustomPermissionsSchema.parse(value).permissions);
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(element.current);
    },
  });

  useEffect(() => {
    form.reset({ permissions: [...props.initial] });
  }, [form, props.initial]);

  return (
    <form.AppForm>
      <form
        ref={element}
        className="space-y-3"
        aria-busy={props.pending}
        onSubmit={(event) => {
          handleFormSubmit(event, () => form.handleSubmit());
        }}
      >
        <p className="text-sm font-medium">
          Custom permissions for {props.username}
        </p>
        <form.AppField name="permissions">
          {(field) => {
            const error = field.state.meta.isTouched
              ? fieldErrorMessage(field.state.meta.errors)
              : undefined;
            return (
              <Field>
                <PermissionChecklist
                  idPrefix={`member-${props.id}-permission`}
                  name={field.name}
                  selected={field.state.value}
                  canAdd={(permission) =>
                    props.permissions.can(
                      permission.resource,
                      permission.action,
                    )
                  }
                  canRemoveSelected={props.canRemoveSelected}
                  onChange={field.handleChange}
                />
                {error === undefined ? null : (
                  <FieldError id={`member-${props.id}-permission-error`}>
                    {error}
                  </FieldError>
                )}
              </Field>
            );
          }}
        </form.AppField>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={props.onCancel}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={props.pending}>
            {props.pending ? "Saving…" : "Save custom"}
          </Button>
        </div>
        <FormPendingStatus pending={props.pending}>
          Saving custom permissions…
        </FormPendingStatus>
      </form>
    </form.AppForm>
  );
}
