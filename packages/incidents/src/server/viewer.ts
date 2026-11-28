/**
 * Browser actor identity. Hub has no login of its own: the tailnet is the
 * access boundary and, like Tracker, actors are self-asserted for attribution,
 * not authorization. Hub's Tailscale ingress inserts `Tailscale-User-Login`
 * and `Tailscale-User-Name` for requests from a user's (untagged) device, so
 * when present they name the human; a human actor in a mutation body is then
 * replaced by `human:<login>`. Agent, runner and system actors are never
 * replaced, so a CLI on Jerred's laptop keeps its session identity.
 */
import { ActorInputSchema, type ActorInput } from "#shared/contract.ts";

export const TAILSCALE_LOGIN_HEADER = "tailscale-user-login";
export const TAILSCALE_NAME_HEADER = "tailscale-user-name";

export function viewerFromRequest(request: Request): ActorInput | null {
  const login = request.headers
    .get(TAILSCALE_LOGIN_HEADER)
    ?.trim()
    .toLowerCase();
  if (login === undefined || login === "") return null;
  const name = request.headers.get(TAILSCALE_NAME_HEADER)?.trim() ?? "";
  const parsed = ActorInputSchema.safeParse({
    key: `human:${login}`,
    kind: "human",
    name: (name === "" ? login : name).slice(0, 120),
  });
  return parsed.success ? parsed.data : null;
}

export function effectiveActor(
  actor: ActorInput,
  viewer: ActorInput | null,
): ActorInput {
  return viewer !== null && actor.kind === "human" ? viewer : actor;
}
