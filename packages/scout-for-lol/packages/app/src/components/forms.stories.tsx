import { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { z } from "zod";
import {
  createPermissionSet,
  permissionsForRole,
  P,
  type Permission,
} from "@scout-for-lol/data";
import { Dialog } from "@scout-for-lol/design-system/components/overlays/dialog";
import { Input } from "@scout-for-lol/design-system/components/forms/field";
import {
  FormPendingStatus,
  ServerFormError,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "./semantic-form.tsx";
import { SemanticDialogForm } from "./dialog-form.tsx";
import {
  BuilderFieldError,
  builderErrorAttributes,
} from "./builder-field-error.tsx";
import {
  CustomPermissionsForm,
  MemberRoleForm,
  type RoleSelection,
} from "./guild-access-forms.tsx";
import { FilterSelect } from "./filter-select.tsx";
import { TimezoneSelect } from "./timezone-select.tsx";
import { Button } from "@scout-for-lol/design-system/components/button";

/** Stories have no backend, so every handler is deliberately inert. */
function noop(): void {
  // Intentionally empty.
}

const ReportFormSchema = z.object({
  title: z.string().min(3, "Give the report a name."),
  description: z.string(),
  channelId: z.string().min(1, "Pick a channel."),
});

const CHANNEL_OPTIONS = [
  { value: "1069813984308248657", label: "#match-reports" },
  { value: "1069814032311730227", label: "#ranked-only" },
  { value: "1069814077526343710", label: "#aram-night" },
];

const ADMIN_PERMISSIONS = createPermissionSet(permissionsForRole("admin"));
const MANAGER_PERMISSIONS = createPermissionSet(permissionsForRole("manager"));
const CUSTOM_PERMISSIONS: Permission[] = [
  P("reports", "read"),
  P("reports", "run"),
  P("players", "read"),
];

const QUEUE_FILTERS = ["ALL", "RANKED_SOLO", "RANKED_FLEX", "ARAM"] as const;
const RESULT_FILTERS = ["ANY", "WINS", "LOSSES"] as const;

function SemanticFieldsExample() {
  const formElement = useRef<HTMLFormElement>(null);
  const form = useScoutForm({
    defaultValues: {
      title: "",
      description: "",
      channelId: CHANNEL_OPTIONS[0]?.value ?? "",
    },
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: ReportFormSchema },
    onSubmit: noop,
  });

  return (
    <form.AppForm>
      <form
        ref={formElement}
        className="max-w-lg space-y-4"
        onSubmit={(event) => {
          handleFormSubmit(event, () => form.handleSubmit());
        }}
      >
        <form.AppField name="title">
          {(field) => (
            <field.TextField
              id="story-report-title"
              label="Report name"
              description="Shown at the top of every posted report."
              placeholder="Weekly ranked recap"
              required
            />
          )}
        </form.AppField>
        <form.AppField name="description">
          {(field) => (
            <field.TextareaField
              id="story-report-description"
              label="Description"
              placeholder="What this report covers"
              rows={3}
            />
          )}
        </form.AppField>
        <form.AppField name="channelId">
          {(field) => (
            <field.NativeSelectField
              id="story-report-channel"
              label="Channel"
              placeholder="Pick a channel"
              options={CHANNEL_OPTIONS}
              required
            />
          )}
        </form.AppField>
        <Button type="submit">Save report</Button>
        <FormPendingStatus pending={false}>Saving report…</FormPendingStatus>
      </form>
    </form.AppForm>
  );
}

function DialogFormExample(props: { pending: boolean; error: string | null }) {
  const formElement = useRef<HTMLFormElement>(null);
  const form = useScoutForm({
    defaultValues: { channelId: CHANNEL_OPTIONS[0]?.value ?? "" },
    onSubmit: noop,
  });

  return (
    <Dialog open={true} onOpenChange={noop}>
      <form.AppForm>
        <SemanticDialogForm
          formRef={formElement}
          title="Move subscription"
          description='Move "bald" from #match-reports.'
          pending={props.pending}
          pendingStatus="Saving subscription channel…"
          error={props.error}
          submitLabel="Save"
          pendingLabel="Saving..."
          onSubmit={() => form.handleSubmit()}
          onCancel={noop}
        >
          <form.AppField name="channelId">
            {(field) => (
              <field.NativeSelectField
                id="story-dialog-channel"
                label="Destination channel"
                placeholder="Pick a channel"
                options={CHANNEL_OPTIONS}
                required
              />
            )}
          </form.AppField>
        </SemanticDialogForm>
      </form.AppForm>
    </Dialog>
  );
}

function BuilderErrorsExample() {
  const errorId = "story-builder-max-participants-error";
  const error = "Minimum games must be a positive whole number.";
  return (
    <div className="max-w-sm space-y-4">
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="story-builder-min">
          Minimum games
        </label>
        <Input
          id="story-builder-min"
          name="minGames"
          defaultValue="0"
          {...builderErrorAttributes(error, errorId)}
        />
        <BuilderFieldError id={errorId} error={error} />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="story-builder-max">
          Maximum participants
        </label>
        <Input
          id="story-builder-max"
          name="maxParticipants"
          defaultValue="50"
        />
        <BuilderFieldError id="story-builder-max-error" error={undefined} />
      </div>
    </div>
  );
}

function GuildAccessExample() {
  const [role, setRole] = useState<RoleSelection>("manager");
  const [permissions, setPermissions] =
    useState<Permission[]>(CUSTOM_PERMISSIONS);
  return (
    <div className="max-w-3xl space-y-6">
      <MemberRoleForm
        id="193138290672074762"
        role={role}
        permissions={ADMIN_PERMISSIONS}
        pending={false}
        editingCustomPermissions={false}
        onSubmit={setRole}
      />
      <CustomPermissionsForm
        id="193138290672074762"
        username="baldbard"
        initial={permissions}
        permissions={MANAGER_PERMISSIONS}
        canRemoveSelected
        pending={false}
        onCancel={noop}
        onSubmit={setPermissions}
      />
    </div>
  );
}

function FilterSelectExample() {
  const [queue, setQueue] =
    useState<(typeof QUEUE_FILTERS)[number]>("RANKED_SOLO");
  const [result, setResult] = useState<(typeof RESULT_FILTERS)[number]>("ANY");
  return (
    <div className="flex max-w-md gap-3">
      <FilterSelect
        label="Queue"
        value={queue}
        options={QUEUE_FILTERS}
        onChange={setQueue}
      />
      <FilterSelect
        label="Result"
        value={result}
        options={RESULT_FILTERS}
        onChange={setResult}
      />
    </div>
  );
}

function TimezoneSelectExample() {
  const [zone, setZone] = useState("America/New_York");
  return (
    <div className="max-w-sm space-y-2">
      <label className="text-sm font-medium" htmlFor="story-timezone">
        Schedule timezone
      </label>
      <TimezoneSelect
        id="story-timezone"
        name="timezone"
        value={zone}
        onChange={setZone}
      />
      <p className="text-xs text-scout-subtle">Reports post at 09:00 {zone}.</p>
    </div>
  );
}

const meta = {
  title: "Components/Forms",
  component: ServerFormError,
  tags: ["autodocs"],
} satisfies Meta<typeof ServerFormError>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SemanticFields: Story = {
  args: { error: null },
  render: () => <SemanticFieldsExample />,
};

export const DialogForm: Story = {
  args: { error: null },
  render: () => (
    <>
      <p className="text-sm text-scout-subtle">
        The shared mutation-dialog shell: native form, pending fieldset, error,
        and Cancel/Save footer.
      </p>
      <DialogFormExample pending={false} error={null} />
    </>
  ),
};

export const DialogFormFailed: Story = {
  args: { error: null },
  render: () => (
    <>
      <p className="text-sm text-scout-subtle">
        The same shell after the mutation returned a typed failure.
      </p>
      <DialogFormExample
        pending={false}
        error="Player is already subscribed in the destination channel."
      />
    </>
  ),
};

export const BuilderErrors: Story = {
  args: { error: null },
  render: () => <BuilderErrorsExample />,
};

export const GuildAccess: Story = {
  args: { error: null },
  render: () => <GuildAccessExample />,
};

export const Selects: Story = {
  args: { error: null },
  render: () => (
    <div className="space-y-6">
      <FilterSelectExample />
      <TimezoneSelectExample />
      <ServerFormError error="Scout could not save that change." />
    </div>
  ),
};
