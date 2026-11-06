import { z } from "zod";
import type { MediaActor, PlexAuthentication } from "#application/auth.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { SystemHttpBrowser } from "#testing/system/browser.ts";
import { UserSchema } from "#shared/contract.ts";

/** Synthetic external PIN boundary; HTTP/session/CSRF and persisted subjects remain production code. */
export function movieHistoryHttpIdentity(context: MediaAutomationContext) {
  let selected: MediaActor | undefined;
  const pins = new Map<number, MediaActor>();
  const tokens = new Map<string, MediaActor>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("Synthetic household Plex authorization"),
  });
  const plex: PlexAuthentication = {
    createPin: () => {
      if (selected === undefined)
        throw new Error(
          "Choose an actual household account before PIN authorization",
        );
      const id = pins.size + 1;
      pins.set(id, selected);
      return Promise.resolve({
        id,
        code: `history-${String(id)}`,
        expiresAt: new Date(Date.now() + 60_000),
        authorizationUrl: server.url.origin,
        deviceState: String(id),
      });
    },
    resolvePin: (id) => {
      const user = pins.get(id);
      if (user === undefined) throw new Error("Unknown actual household PIN");
      const token = `synthetic-history-http:${user.plexAccountId}`;
      tokens.set(token, user);
      return Promise.resolve({
        accountId: user.plexAccountId,
        displayName: user.displayName,
        token,
      });
    },
    resolveServerAccess: async (token) => {
      const user = tokens.get(token);
      if (user === undefined) return null;
      const sections = await context.permittedSections();
      return {
        accountId: user.plexAccountId,
        serverMachineId: z.string().min(1).parse(context.serverMachineId),
        serverToken: `synthetic-history-http-server:${user.plexAccountId}`,
        permittedSectionIds: [sections.movie, sections.series],
        permittedMediaKinds: ["movie", "series"],
        plexRestricted: false,
      };
    },
    resolveServerToken: () =>
      Promise.reject(
        new Error(
          "Current household authority requires complete Plex access observation",
        ),
      ),
    refresh: () =>
      Promise.reject(
        new Error(
          "Current household PIN cannot substitute historical credentials",
        ),
      ),
  };
  return {
    plex,
    origin: server.url.origin,
    select(user: MediaActor) {
      selected = user;
    },
    close: () => server.stop(true),
  };
}

export async function authenticateMovieHistoryHttp(browser: SystemHttpBrowser) {
  const started = await browser.request("/api/v1/auth/plex/start", {
    method: "POST",
  });
  if (started.status !== 201)
    throw new Error(`Real PIN start failed: ${String(started.status)}`);
  const pin = z
    .object({ id: z.uuid(), authorizationUrl: z.url() })
    .parse(await started.json());
  const external = await fetch(pin.authorizationUrl);
  if (external.status !== 200)
    throw new Error("Household authorization URL must return HTTP200");
  const completed = await browser.request(`/api/v1/auth/plex/poll/${pin.id}`, {
    method: "POST",
  });
  if (completed.status !== 200)
    throw new Error(`Real PIN completion failed: ${String(completed.status)}`);
  return z
    .object({ status: z.literal("authenticated"), user: UserSchema })
    .parse(await completed.json()).user;
}

export async function movieHistoryHttpResponse<T extends z.ZodType>(
  response: Response,
  schema: T,
): Promise<z.output<T>> {
  const body: unknown = await response.json();
  if (response.status !== 200)
    throw new Error(
      `History HTTP ${String(response.status)}: ${JSON.stringify(body)}`,
    );
  return schema.parse(body);
}
