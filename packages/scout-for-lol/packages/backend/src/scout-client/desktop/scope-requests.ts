import {
  SCOUT_DESKTOP_API_ROUTES,
  ScoutDesktopScopeRequestResponseSchema,
  ScoutDesktopScopeRequestSchema,
} from "@scout-for-lol/data";
import { authenticateScoutClient } from "#src/scout-client/access/authentication.ts";
import { createScopeUpgrade } from "#src/scout-client/pairing.ts";
import {
  acceptedContractVersion,
  contractUnsupportedResponse,
  desktopErrorResponse,
  desktopJsonResponse,
} from "./contract.ts";
import { INVALID_BODY, readDesktopBody } from "./explore-routes.ts";
import { invalidRequest } from "./explore-run-routes.ts";
import { desktopReadAllowed } from "./rate-limit.ts";

/** A scope request is one short list of scope names. */
const MAX_SCOPE_REQUEST_BYTES = 1024;

/**
 * `POST /devices/current/scope-requests`: a paired device asks for scopes it
 * lacks. Authenticated by the device token alone, never a cookie, and it only
 * records a request for the owner to approve on the web; the device's scopes
 * change only when that signed-in owner approves, so a device cannot grant
 * itself anything.
 *
 * Not gated by the capture kill switch: this is about Explore, and a device
 * that cannot upload yet can still ask.
 */
export async function handleScopeRequestRoute(
  request: Request,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== SCOUT_DESKTOP_API_ROUTES.device_scope_requests.path) {
    return null;
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }
  if (acceptedContractVersion(request) === null) {
    return contractUnsupportedResponse();
  }
  const device = await authenticateScoutClient(request, false);
  if (device === null) {
    return desktopErrorResponse(
      "unauthorized",
      "This device is not signed in.",
    );
  }
  if (!desktopReadAllowed(device.deviceId)) {
    return desktopErrorResponse(
      "rate_limited",
      "Too many requests from this device. Try again shortly.",
    );
  }
  const body = await readDesktopBody(request, MAX_SCOPE_REQUEST_BYTES);
  const input =
    body === INVALID_BODY
      ? null
      : ScoutDesktopScopeRequestSchema.safeParse(body);
  if (input?.success !== true) return invalidRequest();
  const upgrade = await createScopeUpgrade(device, input.data.scopes);
  if (upgrade.status === "already-granted") {
    return desktopErrorResponse(
      "scope_already_granted",
      "This device already has those permissions.",
    );
  }
  const { status: _status, ...created } = upgrade;
  return desktopJsonResponse(
    ScoutDesktopScopeRequestResponseSchema.parse(created),
    201,
  );
}
