import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  CustomAuthResponseSchema,
  type CustomAuthResponse,
} from "@scout-for-lol/data";
import { z } from "zod";
import {
  createDiscordSdkAdapter,
  type ActivityIdentity,
  type ActivityLayoutMode,
  type ActivitySdkAdapter,
} from "@/lib/sdk-adapter";
import { customActivityRefreshDelay } from "@/lib/activity-refresh";
import { fireAndForget } from "@/lib/fire-and-forget";

const ActivityConfigSchema = z.object({
  applicationId: z
    .string()
    .regex(/^\d{17,20}$/)
    .refine(
      (clientId) => clientId !== "000000000000000000",
      "Scout Customs is not configured for this environment",
    ),
  contractHash: z.string().min(1),
});

type ActivitySession = {
  sdk: ActivitySdkAdapter;
  auth: CustomAuthResponse;
  identity: ActivityIdentity;
  guildId: string;
  channelId: string;
  instanceId: string;
  layoutMode: ActivityLayoutMode;
  connectedParticipantCount: number;
};

type ActivitySessionState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; session: ActivitySession };

const ActivitySessionContext = createContext<ActivitySession | null>(null);

class ActivityAuthRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function activityConfiguration() {
  const response = await fetch("/api/customs/config");
  if (!response.ok) {
    throw new Error("Scout Customs is unavailable in this release");
  }
  return ActivityConfigSchema.parse(await response.json());
}

async function authRequest(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new ActivityAuthRequestError(
      response.status,
      `Activity authentication failed (${response.status.toString()}): ${text}`,
    );
  return CustomAuthResponseSchema.parse(JSON.parse(text));
}

function assertContractHash(
  auth: CustomAuthResponse,
  expectedContractHash: string,
): void {
  if (auth.contractHash !== expectedContractHash) {
    throw new Error(
      "Scout Customs was updated while this Activity was open. Close and reopen it.",
    );
  }
}

function shouldRetryActivityRefresh(error: unknown): boolean {
  if (error instanceof ActivityAuthRequestError) {
    return error.status >= 500 || error.status === 408 || error.status === 429;
  }
  if (error instanceof Error) {
    return !(
      error.message === "Discord identity changed during Activity refresh" ||
      error.message ===
        "Scout Customs was updated while this Activity was open. Close and reopen it."
    );
  }
  return true;
}

const ACTIVITY_REFRESH_RETRY_INITIAL_DELAY = 30_000;
const ACTIVITY_REFRESH_RETRY_MAX_DELAY = 5 * 60_000;

async function startActivitySession(): Promise<ActivitySession> {
  const config = await activityConfiguration();
  const sdk = createDiscordSdkAdapter(config.applicationId);
  await sdk.ready();
  if (sdk.guildId === null || sdk.channelId === null || sdk.instanceId === "") {
    throw new Error(
      "Scout Customs must be opened from a Discord guild channel",
    );
  }
  const code = await sdk.authorize();
  const auth = await authRequest("/api/customs/auth/exchange", {
    code,
    guildId: sdk.guildId,
    channelId: sdk.channelId,
    instanceId: sdk.instanceId,
  });
  assertContractHash(auth, config.contractHash);
  const identity = await sdk.authenticate(auth.discordAccessToken);
  const connectedParticipantCount = await sdk.connectedParticipantCount();
  return {
    sdk,
    auth,
    identity,
    guildId: sdk.guildId,
    channelId: sdk.channelId,
    instanceId: sdk.instanceId,
    layoutMode: -1,
    connectedParticipantCount,
  };
}

function layoutName(layoutMode: ActivityLayoutMode): string {
  switch (layoutMode) {
    case 0:
      return "focused";
    case 1:
      return "pip";
    case 2:
      return "grid";
    case -1:
      return "unknown";
  }
}

async function stopSubscriptionsIfAborted(
  signal: AbortSignal,
  subscriptions: readonly (() => Promise<void>)[],
): Promise<boolean> {
  if (!signal.aborted) return false;
  await Promise.all(subscriptions.map(async (stop) => stop()));
  return true;
}

export function ActivitySessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ActivitySessionState>({
    status: "loading",
  });

  useEffect(() => {
    const lifecycle = new AbortController();
    let stopLayout: (() => Promise<void>) | undefined;
    let stopParticipants: (() => Promise<void>) | undefined;
    void (async () => {
      try {
        const session = await startActivitySession();
        if (lifecycle.signal.aborted) return;
        setState({ status: "ready", session });
        stopLayout = await session.sdk.subscribeLayout((layoutMode) => {
          setState((current) =>
            current.status === "ready"
              ? {
                  status: "ready",
                  session: { ...current.session, layoutMode },
                }
              : current,
          );
        });
        if (await stopSubscriptionsIfAborted(lifecycle.signal, [stopLayout]))
          return;
        stopParticipants = await session.sdk.subscribeParticipants(
          (connectedParticipantCount) => {
            setState((current) =>
              current.status === "ready"
                ? {
                    status: "ready",
                    session: {
                      ...current.session,
                      connectedParticipantCount,
                    },
                  }
                : current,
            );
          },
        );
        await stopSubscriptionsIfAborted(lifecycle.signal, [
          stopLayout,
          stopParticipants,
        ]);
      } catch (error) {
        if (!lifecycle.signal.aborted) {
          if (stopLayout !== undefined) {
            fireAndForget(stopLayout, "layout unsubscribe after setup failure");
            stopLayout = undefined;
          }
          if (stopParticipants !== undefined) {
            fireAndForget(
              stopParticipants,
              "participants unsubscribe after setup failure",
            );
            stopParticipants = undefined;
          }
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      lifecycle.abort();
      if (stopLayout !== undefined)
        fireAndForget(stopLayout, "layout unsubscribe");
      if (stopParticipants !== undefined)
        fireAndForget(stopParticipants, "participants unsubscribe");
    };
  }, []);

  const refreshAuth = state.status === "ready" ? state.session.auth : null;
  const refreshSdk = state.status === "ready" ? state.session.sdk : null;
  const refreshIdentityId =
    state.status === "ready" ? state.session.identity.id : null;
  const layoutMode = state.status === "ready" ? state.session.layoutMode : -1;
  useEffect(() => {
    document.documentElement.dataset["discordLayout"] = layoutName(layoutMode);
    return () => {
      delete document.documentElement.dataset["discordLayout"];
    };
  }, [layoutMode]);

  useEffect(() => {
    if (
      refreshAuth === null ||
      refreshSdk === null ||
      refreshIdentityId === null
    )
      return;
    const delay = customActivityRefreshDelay(refreshAuth.expiresAt);
    let retryDelay = ACTIVITY_REFRESH_RETRY_INITIAL_DELAY;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    let disposed = false;
    let authForRetry = refreshAuth;
    const refresh = async () => {
      try {
        const auth = await authRequest("/api/customs/auth/refresh", {
          activityToken: authForRetry.activityToken,
          discordRefreshToken: authForRetry.discordRefreshToken,
        });
        authForRetry = auth;
        const identity = await refreshSdk.authenticate(auth.discordAccessToken);
        if (identity.id !== refreshIdentityId) {
          throw new Error("Discord identity changed during Activity refresh");
        }
        setState((current) =>
          current.status === "ready"
            ? {
                status: "ready",
                session: { ...current.session, auth, identity },
              }
            : current,
        );
        retryDelay = ACTIVITY_REFRESH_RETRY_INITIAL_DELAY;
      } catch (error) {
        if (disposed) return;
        if (!shouldRetryActivityRefresh(error)) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        timer = globalThis.setTimeout(() => {
          void refresh();
        }, retryDelay);
        retryDelay = Math.min(ACTIVITY_REFRESH_RETRY_MAX_DELAY, retryDelay * 2);
      }
    };
    timer = globalThis.setTimeout(() => {
      void refresh();
    }, delay);
    return () => {
      disposed = true;
      if (timer !== undefined) globalThis.clearTimeout(timer);
    };
  }, [refreshAuth, refreshIdentityId, refreshSdk]);

  const value = useMemo(
    () => (state.status === "ready" ? state.session : null),
    [state],
  );
  if (state.status === "loading") {
    return (
      <div className="grid min-h-dvh place-items-center">Opening Customs…</div>
    );
  }
  if (state.status === "error") {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <h1 className="font-heading text-xl font-semibold">
            Couldn’t open Customs
          </h1>
          <p className="mt-2 max-w-md text-sm text-scout-subtle">
            {state.message}
          </p>
        </div>
      </main>
    );
  }
  if (value === null) throw new Error("Ready Activity session is missing");
  return (
    <ActivitySessionContext.Provider value={value}>
      {children}
    </ActivitySessionContext.Provider>
  );
}

export function useActivitySession(): ActivitySession {
  const session = useContext(ActivitySessionContext);
  if (session === null)
    throw new Error("useActivitySession must be used within its provider");
  return session;
}
