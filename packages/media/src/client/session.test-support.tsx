import { QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { UserSchema } from "#shared/contract.ts";
import { RecoveryDetailSchema } from "#shared/recovery.ts";
import { App } from "./app.tsx";
import { queryClient, readApi, readSession } from "./api.ts";

export const reviewId = "00000000-0000-4000-8000-000000000001";
export const privateTitle = "Fictional Owner Private Film";
export const recoveryKey = ["recovery", reviewId];
export const owner = UserSchema.parse({
  id: "00000000-0000-4000-8000-000000000002",
  plexAccountId: "synthetic-owner",
  displayName: "Synthetic Owner",
  role: "owner",
  restricted: false,
  version: 1,
});
export const member = UserSchema.parse({
  ...owner,
  id: "00000000-0000-4000-8000-000000000003",
  plexAccountId: "synthetic-member",
  displayName: "Synthetic Member",
  role: "member",
});
export const ownerReview = RecoveryDetailSchema.parse({
  id: reviewId,
  state: "reviewing",
  version: 1,
  scopeHash: "a".repeat(64),
  responseHash: null,
  expiresAt: "2099-01-01T00:00:00.000Z",
  scope: {
    excludedUsers: [],
    recoveryEpoch: 1,
    runtimeVersion: 1,
    media: [
      {
        id: "00000000-0000-4000-8000-000000000004",
        title: privateTitle,
        kind: "movie",
        sectionId: "1",
        version: 1,
        generation: 1,
        automationEpoch: 1,
      },
    ],
    holds: [],
    users: [],
    assets: [],
    requests: [],
    coverage: [],
    personalHolds: [],
    handoffReceipts: [],
    nativeReceipts: [],
    blockers: [],
  },
  responses: [],
  missingUserIds: [],
  receiptId: null,
});

export function denied(status = 403) {
  return Response.json(
    { error: { code: "denied", message: "Synthetic access denied" } },
    { status },
  );
}

export function sessionFixture() {
  const routes = new Map<string, () => Response | Promise<Response>>();
  const calls: { url: string; input: RequestInit | undefined }[] = [];
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
    removeItem: (key: string) => {
      stored.delete(key);
    },
  };
  routes.set("/api/v1/me", () => Response.json(owner));
  routes.set(`/api/v1/recovery/reviews/${reviewId}`, () =>
    Response.json(ownerReview),
  );
  routes.set("/api/v1/auth/plex/poll/synthetic", () =>
    Response.json({
      status: "authenticated",
      user: member,
      csrfToken: "synthetic-only",
    }),
  );
  routes.set("/api/v1/auth/logout", () => new Response(null, { status: 204 }));
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("document", { cookie: "media-csrf=synthetic-only" });
  vi.stubGlobal("fetch", (url: string, input?: RequestInit) => {
    calls.push({ url, input });
    const response = routes.get(url);
    if (response === undefined)
      throw new Error(`Unregistered synthetic route: ${url}`);
    return Promise.resolve(response());
  });
  return { routes, calls, stored, storage };
}

export const sessionQuery = {
  queryKey: ["me"],
  queryFn: readSession,
  staleTime: 0,
};
export const recoveryQuery = {
  queryKey: recoveryKey,
  queryFn: () => readApi(`/recovery/reviews/${reviewId}`, RecoveryDetailSchema),
  staleTime: 0,
};

export async function loadOwner() {
  await queryClient.query(sessionQuery);
  await queryClient.query(recoveryQuery);
}

export async function captureFailure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the retired operation to reject");
}

export function renderSession() {
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/recovery/${reviewId}`]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
