export const PHOTON_NOW = "2026-10-03T12:00:00.000Z";
export function photonEnvelope(
  text = "/new claude remember orchid",
  id = "incoming-message",
) {
  const space = {
    id: "any;-;+15550000001",
    platform: "imessage",
    type: "dm",
    phone: "+15550000002",
  };
  return {
    event: "messages",
    space,
    message: {
      id,
      platform: "imessage",
      direction: "inbound",
      timestamp: PHOTON_NOW,
      sender: { id: "+15550000001", platform: "imessage" },
      space: { ...space },
      content: { type: "text", text },
    },
  };
}
