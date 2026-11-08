import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { RiotAccountsSettings } from "#src/components/settings/riot-accounts.tsx";
import { readCsrfCookie, useTRPC } from "#src/lib/query/trpc.ts";

const StartSchema = z.object({ authorizeUrl: z.url() });
const ErrorSchema = z.object({ message: z.string() });
const CALLBACK_MESSAGES: Readonly<Record<string, string>> = {
  cancelled:
    "Riot sign-in was cancelled. Your accounts and notification settings have not changed.",
  expired:
    "That Riot sign-in expired or was already used. Please start linking again.",
  failed: "Riot account verification could not complete. Please try again.",
  "project-mismatch":
    "Riot verification is not configured for Scout’s API project. Please contact support.",
};

export function AccountSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const callback = params.get("riot");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const finishing = useRef(false);
  const accounts = useQuery(trpc.riotAccount.list.queryOptions());
  const refresh = () => {
    return queryClient.invalidateQueries({
      queryKey: trpc.riotAccount.list.queryKey(),
    });
  };
  const complete = useMutation(
    trpc.riotAccount.completeLink.mutationOptions({
      retry: false,
      onSuccess: async ({ kind }) => {
        if (kind === "linked") {
          setNotice(
            "Riot account verified. You can now choose its match notifications.",
          );
          await refresh();
        } else
          setError(
            kind === "account-conflict"
              ? "This Riot account is linked to another Discord login. Contact support to resolve the existing link."
              : (CALLBACK_MESSAGES["expired"] ?? null),
          );
      },
      onError: async () => {
        setError(
          "The Riot link could not be completed. Refresh your accounts before trying again.",
        );
        await refresh();
      },
      onSettled: () => {
        setParams({}, { replace: true });
      },
    }),
  );
  const finishLink = complete.mutate;
  useEffect(() => {
    if (callback === "complete" && !finishing.current) {
      finishing.current = true;
      finishLink();
    }
  }, [callback, finishLink]);
  const toggle = useMutation(
    trpc.riotAccount.setMatchNotifications.mutationOptions({
      retry: false,
      onSuccess: async ({ enabled }) => {
        setError(null);
        setNotice(
          enabled
            ? "Match notifications enabled for this account."
            : "This account will no longer trigger match notifications in any Scout server.",
        );
        await refresh();
      },
      onError: (failure) => {
        setError(failure.message);
      },
    }),
  );

  async function startLink() {
    setLinking(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/auth/riot/start", {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRF-Token": readCsrfCookie() ?? "" },
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsed = ErrorSchema.safeParse(body);
        setError(
          parsed.success
            ? parsed.data.message
            : "Riot sign-in could not start. Please retry.",
        );
        return;
      }
      const { authorizeUrl } = StartSchema.parse(body);
      if (new URL(authorizeUrl).origin !== "https://auth.riotgames.com")
        throw new Error("Unexpected Riot authorization origin");
      globalThis.location.assign(authorizeUrl);
    } catch {
      setError("Riot sign-in could not start. Please retry.");
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-10">
      <h1 className="text-2xl font-semibold">Account settings</h1>
      {accounts.isPending && <p role="status">Loading League accounts…</p>}
      {accounts.error !== null && (
        <p role="alert" className="text-scout-danger">
          Your account settings could not load. Please refresh.
        </p>
      )}
      {accounts.data !== undefined && (
        <RiotAccountsSettings
          data={accounts.data}
          linking={linking || complete.isPending}
          savingPuuid={toggle.isPending ? toggle.variables.puuid : null}
          notice={notice}
          error={
            error ??
            (callback === null ? null : (CALLBACK_MESSAGES[callback] ?? null))
          }
          onLink={() => {
            void startLink();
          }}
          onSetEnabled={(account, enabled) => {
            toggle.mutate({ puuid: account.puuid, enabled });
          }}
        />
      )}
    </div>
  );
}
