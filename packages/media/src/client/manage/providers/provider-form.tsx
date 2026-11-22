import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CommandResultSchema } from "#shared/api.ts";
import type { ProviderStatus, SaveProvider } from "#shared/admin.ts";
import { queryClient, writeApi } from "#client/api.ts";
import { dateLabel } from "#client/components.tsx";
import { useUser } from "#client/shell/user.ts";
import { Button } from "#client/ui/button.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { ConfirmDialog } from "#client/ui/confirm-dialog.tsx";
import { DurationField } from "#client/ui/forms/duration-field.tsx";
import { formatDuration } from "#client/ui/forms/duration.ts";
import {
  CheckboxField,
  FieldGroup,
  TextField,
} from "#client/ui/forms/field.tsx";
import { Form, FormFooter } from "#client/ui/forms/form.tsx";
import {
  CREDENTIAL_FIELDS,
  DURATION_RULES,
  readProvider,
} from "./provider-input.ts";
import { SeedingFields } from "./seeding-fields.tsx";
import styles from "./providers.module.css";

const cx = classNames(styles);

type LastError = NonNullable<ProviderStatus["lastError"]>;

export const PROVIDER_NAMES: Readonly<Record<ProviderStatus["id"], string>> = {
  knaben: "Knaben",
  thepiratebay: "The Pirate Bay",
  magnetdownload: "MagnetDownload",
  privatehd: "PrivateHD",
  avistaz: "AvistaZ",
  animez: "AnimeZ",
  opensubtitles: "OpenSubtitles",
  assrt: "ASSRT",
  subhd: "SubHD",
  zimuku: "Zimuku",
  subf2m: "Subf2m",
};

export const LAST_ERRORS: Readonly<Record<LastError, string>> = {
  authentication: "Sign-in failed",
  "rate-limited": "Rate limited",
  unavailable: "Unavailable",
  "invalid-response": "Unreadable response",
  "outcome-unknown": "Result unknown",
  "interaction-required": "Needs a manual step",
  conflict: "Conflict",
};

const FEED_STATES: Readonly<Record<ProviderStatus["feedState"], string>> = {
  unconfigured: "Not set up.",
  unsupported_recent_feed:
    "This tracker has no recent-release listing. Media searches it for each title on a schedule.",
  current: "Up to date.",
  catching_up: "Reading earlier releases to catch up.",
  error:
    "The listing could not be refreshed. See the last result for the reason.",
  paused:
    "Paused while this tracker or all downloading is off, or while the library’s ownership is unconfirmed.",
};

const CREDENTIAL_LABELS: Readonly<Record<string, string>> = {
  username: "Username",
  password: "Password",
  pid: "PID",
  apiKey: "API key",
  userAgent: "User agent",
  token: "Token",
  baseUrl: "Address",
  instanceId: "Instance ID",
};

function credentialLabel(field: string): string {
  const label = CREDENTIAL_LABELS[field];
  if (label === undefined) {
    throw new Error(`The credential field ${field} has no label`);
  }
  return label;
}

/** What Media knows about the provider right now. Nothing here is editable. */
function ProviderFacts({ provider }: { provider: ProviderStatus }) {
  const selection = provider.configuration.selection;
  return (
    <dl className={cx("facts")}>
      <div>
        <dt>Last result</dt>
        <dd>
          {provider.lastError === null
            ? "No failure recorded. Saving these settings does not test the connection."
            : `${LAST_ERRORS[provider.lastError]}.`}
        </dd>
      </div>
      {provider.kind === "tracker" && (
        <div>
          <dt>Recent releases</dt>
          <dd>
            {FEED_STATES[provider.feedState]}
            {provider.lastFeedAt !== null &&
              ` Last read ${dateLabel(provider.lastFeedAt)}.`}
          </dd>
        </div>
      )}
      {provider.nextAllowedAt !== null && (
        <div>
          <dt>Next request</dt>
          <dd>Not before {dateLabel(provider.nextAllowedAt)}.</dd>
        </div>
      )}
      {provider.kind === "tracker" && selection !== undefined && (
        <div>
          <dt>Choosing releases</dt>
          <dd>
            Priority {selection.priority}. Needs at least{" "}
            {selection.minimumSeeders} seeder
            {selection.minimumSeeders === 1 ? "" : "s"}. Waits{" "}
            {formatDuration(selection.delaySeconds)} before choosing
            {selection.bypassAtHighestQuality
              ? ", unless the release is already the best quality allowed."
              : "."}
          </dd>
        </div>
      )}
    </dl>
  );
}

function CredentialFields({
  provider,
  fields,
  replacing,
  setReplacing,
}: {
  provider: ProviderStatus;
  fields: readonly string[];
  replacing: boolean;
  setReplacing: (replacing: boolean) => void;
}) {
  const stored = provider.credentialConfigured;
  return (
    <FieldGroup
      legend="Sign-in details"
      description={
        stored
          ? "Stored encrypted. This page never shows them; you can only replace them."
          : "None are stored. This provider cannot be used until you add them."
      }
    >
      {replacing ? (
        <>
          <input type="hidden" name="replaceCredential" value="on" />
          {fields.map((field) => (
            <TextField
              key={field}
              label={credentialLabel(field)}
              name={`credential.${field}`}
              type={field === "baseUrl" ? "url" : "password"}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              width="medium"
            />
          ))}
          <div>
            <Button
              variant="quiet"
              onClick={() => {
                setReplacing(false);
              }}
            >
              {stored ? "Keep the stored details" : "Do not add them now"}
            </Button>
          </div>
        </>
      ) : (
        <div>
          <Button
            onClick={() => {
              setReplacing(true);
            }}
          >
            {stored ? "Replace sign-in details" : "Add sign-in details"}
          </Button>
        </div>
      )}
    </FieldGroup>
  );
}

export function ProviderForm({
  provider,
  headingId,
  saved,
  onSaved,
  onEdit,
}: {
  provider: ProviderStatus;
  /** The id of the heading that names this provider. */
  headingId: string;
  saved: string | null;
  onSaved: (message: string) => void;
  onEdit: () => void;
}) {
  const user = useUser();
  const name = PROVIDER_NAMES[provider.id];
  const fields = CREDENTIAL_FIELDS[provider.id] ?? [];
  const [replacing, setReplacing] = useState(false);
  const [unplaced, setUnplaced] = useState<Error | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  // Holds the new credential between the submit and the confirmation.
  const pending = useRef<SaveProvider | null>(null);
  const save = useMutation({
    mutationFn: async (input: SaveProvider) =>
      writeApi({
        actorId: user.id,
        path: `/admin/providers/${provider.id}`,
        body: input,
        schema: CommandResultSchema,
        method: "PUT",
        sensitive: true,
      }),
    onSuccess: async () => {
      onSaved(`${name} settings saved.`);
      return queryClient.invalidateQueries({ queryKey: ["admin-providers"] });
    },
  });
  function submit(form: HTMLFormElement) {
    const read = readProvider(new FormData(form), provider);
    if (!read.ok) {
      setUnplaced(
        new Error(
          "These settings were not sent. Check the limits, the seeding rules, and the sign-in details.",
        ),
      );
      return;
    }
    setUnplaced(null);
    if (read.input.credential != null && provider.credentialConfigured) {
      pending.current = read.input;
      dialog.current?.showModal();
      return;
    }
    save.mutate(read.input);
  }
  return (
    <>
      <ProviderFacts provider={provider} />
      <Form
        labelledBy={headingId}
        validate={(form) => {
          const read = readProvider(new FormData(form), provider);
          return read.ok ? {} : read.fields;
        }}
        onSubmit={submit}
        onEdit={onEdit}
      >
        <CheckboxField
          label="Use this provider"
          description={
            provider.kind === "tracker"
              ? "Media searches this tracker and reads its recent releases."
              : "Media looks for subtitles here."
          }
          name="enabled"
          defaultChecked={provider.enabled}
        />
        <DurationField
          label="Shortest wait between requests"
          name="minimumIntervalSeconds"
          rules={DURATION_RULES.minimumIntervalSeconds}
          requiredMessage="Enter a time from 1 second to 60 minutes."
          defaultSeconds={provider.configuration.minimumIntervalSeconds}
        />
        {provider.kind === "subtitle" ? (
          <TextField
            label="Most downloads in a day"
            name="dailyDownloadLimit"
            type="number"
            min={1}
            max={1000}
            step={1}
            required
            requiredMessage="Enter a number of downloads from 1 to 1000."
            unit="per day"
            defaultValue={provider.configuration.dailyDownloadLimit}
          />
        ) : (
          <input
            type="hidden"
            name="dailyDownloadLimit"
            value={provider.configuration.dailyDownloadLimit}
          />
        )}
        {provider.kind === "tracker" ? (
          <SeedingFields provider={provider} />
        ) : (
          <input type="hidden" name="policyKind" value="unknown" />
        )}
        {fields.length > 0 && (
          <CredentialFields
            provider={provider}
            fields={fields}
            replacing={replacing}
            setReplacing={setReplacing}
          />
        )}
        <FormFooter
          submitLabel="Save provider"
          pendingLabel="Saving…"
          pending={save.isPending}
          saved={saved}
          error={unplaced ?? save.error}
        />
      </Form>
      <ConfirmDialog
        ref={dialog}
        title={`Replace the sign-in details for ${name}?`}
        confirmLabel="Replace and save"
        danger
        onConfirm={() => {
          const input = pending.current;
          pending.current = null;
          if (input !== null) save.mutate(input);
        }}
        onCancel={() => {
          pending.current = null;
        }}
      >
        <p>
          The details stored now are overwritten. They cannot be read back or
          restored, so keep a copy of the old ones if you might need them.
        </p>
      </ConfirmDialog>
    </>
  );
}
