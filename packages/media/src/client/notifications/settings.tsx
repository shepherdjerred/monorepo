import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  CommandResultSchema,
  NotificationPreferencesSchema,
  type NotificationPreferences,
} from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import { queryClient, readApi, writeApi } from "#client/api.ts";
import { PageTitle } from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { SkeletonStatus } from "#client/ui/skeleton.tsx";
import skeletonStyles from "#client/ui/skeleton.module.css";
import { ErrorState } from "#client/ui/states.tsx";
import styles from "./notifications.module.css";

const cx = classNames(styles);
const block = classNames(skeletonStyles)("block");

/** What the settings read is cached under, and invalidated by. */
export const PREFERENCES_KEY = ["notification-preferences"] as const;

const DiscordStartSchema = z.object({ authorizationUrl: z.url() });

function refreshPreferences() {
  return queryClient.invalidateQueries({ queryKey: PREFERENCES_KEY });
}

function Problem({ error }: { error: Error | null }) {
  if (error === null) return null;
  return (
    <p className={cx("formError")} role="alert">
      {error.message}
    </p>
  );
}

/** The address Media writes to, and the email that proves it is the reader's. */
function EmailAddress({
  user,
  preferences,
}: {
  user: MediaUser;
  preferences: NotificationPreferences;
}) {
  const fieldId = useId();
  const [email, setEmail] = useState(preferences.email ?? "");
  const verify = useMutation({
    mutationFn: async () =>
      writeApi({
        actorId: user.id,
        path: "/notifications/email",
        body: { email },
        schema: CommandResultSchema,
      }),
  });
  return (
    <div className={cx("channelSetting")}>
      <h3>Email</h3>
      <p className={cx("line")}>
        {preferences.emailVerified && preferences.email !== null
          ? `Media writes to ${preferences.email}, which you confirmed.`
          : "Add an address to hear from Media by email. It is used once you confirm it."}
      </p>
      <form
        className={cx("inlineForm")}
        onSubmit={(event) => {
          event.preventDefault();
          verify.mutate();
        }}
      >
        <label className={cx("fieldLabel")} htmlFor={fieldId}>
          Email address
        </label>
        <div className={cx("fieldRow")}>
          <input
            className={cx("textField")}
            id={fieldId}
            type="email"
            name="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            required
          />
          <button className="button" type="submit" disabled={verify.isPending}>
            {verify.isPending ? "Sending…" : "Send verification email"}
          </button>
        </div>
      </form>
      {verify.isSuccess && (
        <p className={cx("formDone")} role="status">
          Verification email sent. Follow the link in it to confirm the address.
        </p>
      )}
      <Problem error={verify.error} />
    </div>
  );
}

/** The Discord account Media messages, linked and unlinked through Discord. */
function DiscordAccount({
  user,
  preferences,
}: {
  user: MediaUser;
  preferences: NotificationPreferences;
}) {
  const link = useMutation({
    mutationFn: async () =>
      writeApi({
        actorId: user.id,
        path: "/notifications/discord/start",
        body: {},
        schema: DiscordStartSchema,
      }),
    onSuccess: (result) => {
      globalThis.location.assign(result.authorizationUrl);
    },
  });
  const unlink = useMutation({
    mutationFn: async () =>
      writeApi({
        actorId: user.id,
        path: "/notifications/discord",
        method: "DELETE",
        body: {},
        schema: CommandResultSchema,
      }),
    onSuccess: refreshPreferences,
  });
  const { discordLinked, discordAvailable } = preferences;
  const busy = link.isPending || unlink.isPending;
  return (
    <div className={cx("channelSetting")}>
      <h3>Discord</h3>
      <p className={cx("line")}>
        {discordLinked
          ? "Your Discord account is linked."
          : discordAvailable
            ? "Link your Discord account to hear from Media in a direct message. Linking opens Discord to ask you."
            : "This Media is not set up to send Discord messages."}
      </p>
      {(discordLinked || discordAvailable) && (
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => {
            if (discordLinked) unlink.mutate();
            else link.mutate();
          }}
        >
          {discordLinked ? "Unlink Discord" : "Link Discord"}
        </button>
      )}
      <Problem error={link.error} />
      <Problem error={unlink.error} />
    </div>
  );
}

type Draft = Pick<
  NotificationPreferences,
  "emailEnabled" | "discordEnabled" | "upgrades" | "removalCompleted"
>;

function Check({
  label,
  hint = null,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  /** Why the box cannot be ticked yet. */
  hint?: string | null;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const hintId = useId();
  return (
    <div className={cx("check")}>
      <label>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={hint === null ? undefined : hintId}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
        {label}
      </label>
      {hint !== null && (
        <p className={cx("checkHint")} id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * Which channels Media uses and which optional news it sends. Saved as one
 * change that names the version it was read at.
 */
function Preferences({
  user,
  preferences,
  saved,
  onSaved,
}: {
  user: MediaUser;
  preferences: NotificationPreferences;
  /** Whether what is stored is what this form last saved. */
  saved: boolean;
  onSaved: (saved: boolean) => void;
}) {
  const [draft, setDraftOnly] = useState<Draft>({
    emailEnabled: preferences.emailEnabled,
    discordEnabled: preferences.discordEnabled,
    upgrades: preferences.upgrades,
    removalCompleted: preferences.removalCompleted,
  });
  const save = useMutation({
    mutationFn: async () =>
      writeApi({
        actorId: user.id,
        path: "/notifications/preferences",
        method: "PUT",
        body: { ...draft, expectedVersion: preferences.version },
        schema: CommandResultSchema,
      }),
    onSuccess: async () => {
      onSaved(true);
      await refreshPreferences();
    },
  });
  /** A change after a save means the form no longer shows what is stored. */
  function setDraft(next: Draft) {
    onSaved(false);
    setDraftOnly(next);
  }
  const discordHint = preferences.discordAvailable
    ? preferences.discordLinked
      ? null
      : "Link Discord first."
    : "Discord messages are not set up here.";
  return (
    <form
      className={cx("preferences")}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <fieldset className={cx("checks")}>
        <legend>Send notifications by</legend>
        <Check
          label="Email"
          hint={preferences.emailVerified ? null : "Confirm an address first."}
          checked={draft.emailEnabled}
          disabled={!preferences.emailVerified}
          onChange={(emailEnabled) => {
            setDraft({ ...draft, emailEnabled });
          }}
        />
        <Check
          label="Discord direct message"
          hint={discordHint}
          checked={draft.discordEnabled}
          disabled={discordHint !== null}
          onChange={(discordEnabled) => {
            setDraft({ ...draft, discordEnabled });
          }}
        />
      </fieldset>
      <fieldset className={cx("checks")}>
        <legend>Also tell me when</legend>
        <Check
          label="A better version of something arrives"
          checked={draft.upgrades}
          onChange={(upgrades) => {
            setDraft({ ...draft, upgrades });
          }}
        />
        <Check
          label="A removal completes"
          checked={draft.removalCompleted}
          onChange={(removalCompleted) => {
            setDraft({ ...draft, removalCompleted });
          }}
        />
      </fieldset>
      <div className={cx("formActions")}>
        <button
          className="button primary"
          type="submit"
          disabled={save.isPending}
        >
          {save.isPending ? "Saving…" : "Save preferences"}
        </button>
        {saved && (
          <p className={cx("formDone")} role="status">
            Preferences saved.
          </p>
        )}
      </div>
      <Problem error={save.error} />
    </form>
  );
}

/**
 * How Media reaches the reader and what it tells them: the email address and
 * Discord account it uses, and which messages it sends. Reached from the
 * account menu.
 */
export function NotificationSettingsPage({ user }: { user: MediaUser }) {
  // Kept here because a save gives the form below a new version to start
  // from, and with it a new instance.
  const [saved, setSaved] = useState(false);
  const settings = useQuery({
    queryKey: PREFERENCES_KEY,
    queryFn: async () =>
      readApi("/notifications/preferences", NotificationPreferencesSchema),
  });

  function content() {
    if (settings.error !== null) {
      return (
        <ErrorState
          error={settings.error}
          what="Your notification settings"
          onRetry={() => {
            void settings.refetch();
          }}
        />
      );
    }
    if (settings.isPending) {
      return (
        <SkeletonStatus label="Loading notification settings">
          <div className={cx("settings")}>
            {[0, 1].map((section) => (
              <div className={cx("setting")} key={section}>
                <div className={`${block} ${cx("skeletonHeading")}`} />
                <div className={`${block} ${cx("skeletonLine")}`} />
                <div className={`${block} ${cx("skeletonField")}`} />
              </div>
            ))}
          </div>
        </SkeletonStatus>
      );
    }
    const preferences = settings.data;
    return (
      <div className={cx("settings")}>
        <section className={cx("setting")}>
          <h2>Where Media reaches you</h2>
          <EmailAddress
            key={preferences.email}
            user={user}
            preferences={preferences}
          />
          <DiscordAccount user={user} preferences={preferences} />
        </section>
        <section className={cx("setting")}>
          <h2>What Media sends</h2>
          <p className={cx("line")}>
            A warning that something is leaving is always shown in Media,
            whatever you choose here.
          </p>
          {/* A saved or refetched version starts the form from what is stored. */}
          <Preferences
            key={preferences.version}
            user={user}
            preferences={preferences}
            saved={saved}
            onSaved={setSaved}
          />
        </section>
      </div>
    );
  }

  return (
    <>
      <PageTitle title="Notification settings">
        <p>How Media reaches you, and what it tells you about.</p>
      </PageTitle>
      {content()}
    </>
  );
}
