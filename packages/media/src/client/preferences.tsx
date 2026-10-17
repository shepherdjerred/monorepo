import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router";
import { z } from "zod";
import {
  CommandResultSchema,
  NotificationPreferencesSchema,
} from "#shared/api.ts";
import type { NotificationPreferences } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import { queryClient, readApi, writeApi } from "./api.ts";
import { ErrorNotice, Loading, Notice, PageTitle } from "./components.tsx";

const DiscordStartSchema = z.object({ authorizationUrl: z.url() });

export function NotificationSettings({ user }: { user: MediaUser }) {
  const settings = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: async () =>
      readApi("/notifications/preferences", NotificationPreferencesSchema),
  });
  if (settings.isPending) return <Loading />;
  if (settings.error !== null) return <ErrorNotice error={settings.error} />;
  return (
    <section className="panel">
      <h2>How you hear from us</h2>
      <PreferencesForm
        key={settings.data.version}
        user={user}
        preferences={settings.data}
      />
      <ContactSettings user={user} preferences={settings.data} />
    </section>
  );
}

function PreferencesForm({
  user,
  preferences,
}: {
  user: MediaUser;
  preferences: NotificationPreferences;
}) {
  const [draft, setDraft] = useState({
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
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });
  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <label className="check-label">
        <input
          type="checkbox"
          checked={draft.emailEnabled}
          disabled={!preferences.emailVerified}
          onChange={(event) => {
            setDraft({ ...draft, emailEnabled: event.target.checked });
          }}
        />
        Send updates by email
        {preferences.emailVerified ? "" : " (verify an address first)"}
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={draft.discordEnabled}
          disabled={!preferences.discordLinked}
          onChange={(event) => {
            setDraft({ ...draft, discordEnabled: event.target.checked });
          }}
        />
        Send personal Discord messages
        {preferences.discordLinked ? "" : " (link Discord first)"}
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={draft.upgrades}
          onChange={(event) => {
            setDraft({ ...draft, upgrades: event.target.checked });
          }}
        />
        Tell me when a better version arrives
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={draft.removalCompleted}
          onChange={(event) => {
            setDraft({ ...draft, removalCompleted: event.target.checked });
          }}
        />
        Tell me when a removal completes
      </label>
      <button className="button" type="submit" disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save preferences"}
      </button>
      {save.error !== null && <ErrorNotice error={save.error} />}
    </form>
  );
}

function ContactSettings({
  user,
  preferences,
}: {
  user: MediaUser;
  preferences: NotificationPreferences;
}) {
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
  const discord = useMutation({
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
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });
  return (
    <div className="contact-settings">
      <h3>Connected channels</h3>
      <p className="muted">
        {preferences.emailVerified
          ? `Verified email: ${preferences.email ?? ""}`
          : "Add an email address to receive personal updates."}
      </p>
      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          verify.mutate();
        }}
      >
        <label htmlFor="notification-email">Email address</label>
        <input
          id="notification-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          required
        />
        <button className="button" disabled={verify.isPending} type="submit">
          Send verification email
        </button>
      </form>
      {verify.isSuccess && (
        <Notice>
          Verification email queued. Follow the link in your email to confirm
          the address.
        </Notice>
      )}
      {verify.error !== null && <ErrorNotice error={verify.error} />}
      <div className="list-row">
        <span>
          {preferences.discordLinked
            ? "Discord account linked"
            : "Discord not linked"}
        </span>
        <button
          className="button"
          disabled={discord.isPending || unlink.isPending}
          onClick={() => {
            if (preferences.discordLinked) unlink.mutate();
            else discord.mutate();
          }}
        >
          {preferences.discordLinked ? "Unlink Discord" : "Link Discord"}
        </button>
      </div>
      {discord.error !== null && <ErrorNotice error={discord.error} />}
      {unlink.error !== null && <ErrorNotice error={unlink.error} />}
    </div>
  );
}

export function NotificationCallback({
  user,
  channel,
}: {
  user: MediaUser;
  channel: "email" | "discord";
}) {
  const [parameters] = useSearchParams();
  const location = useLocation();
  const confirm = useMutation({
    mutationFn: async () => {
      const body =
        channel === "email"
          ? { token: new URLSearchParams(location.hash.slice(1)).get("verify") }
          : {
              code: parameters.get("code"),
              state: parameters.get("state"),
              issuer: parameters.get("iss"),
            };
      return writeApi({
        actorId: user.id,
        path:
          channel === "email"
            ? "/notifications/email/verify"
            : "/notifications/discord/complete",
        body,
        schema: CommandResultSchema,
      });
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });
  return (
    <>
      <PageTitle
        eyebrow="Personal updates"
        title={
          channel === "email"
            ? "Verify your email"
            : "Connect your Discord account"
        }
      >
        <p>Confirm to connect this notification channel to your account.</p>
      </PageTitle>
      {confirm.isSuccess ? (
        <Notice>
          Channel connected.{" "}
          <Link to="/notifications">Manage notifications →</Link>
        </Notice>
      ) : (
        <button
          className="button primary"
          disabled={confirm.isPending}
          onClick={() => {
            confirm.mutate();
          }}
        >
          {confirm.isPending ? "Confirming…" : "Confirm connection"}
        </button>
      )}
      {confirm.error !== null && <ErrorNotice error={confirm.error} />}
    </>
  );
}
