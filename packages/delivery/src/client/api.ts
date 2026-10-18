import { createDeliveryClient } from "#shared/client.ts";
import { createHubClient } from "#shared/hub/hub-client.ts";

const baseUrl = globalThis.location.origin;

/** Release requests and decisions. */
export const delivery = createDeliveryClient({ baseUrl });
/** Read models behind the hub pages. */
export const hub = createHubClient({ baseUrl });
