import { brimServiceRequest } from "#lib/brim/shared.ts";
import { loadToolkitConfig } from "#lib/toolkit-config.ts";

function priorityRoute(
  coreId: string | undefined,
  terminalId: string | undefined,
) {
  if (
    coreId === undefined ||
    terminalId === undefined ||
    coreId.length === 0 ||
    terminalId.length === 0
  )
    throw new Error("A Herdr core and terminal ID are required");
  return `/v1/priorities/${encodeURIComponent(coreId)}/${encodeURIComponent(terminalId)}`;
}

export async function handleBrimMetadata(args: readonly string[]) {
  const [action, coreId, terminalId, body = "{}"] = args;
  const config = await loadToolkitConfig();
  if ((await config.value("brimServiceUrl")) === null) {
    console.log(JSON.stringify({ configured: false }));
    return;
  }
  const headers = { "content-type": "application/json" };
  let response: Response;
  switch (action) {
    case "list":
      response = await brimServiceRequest("/v1/priorities");
      break;
    case "get":
      response = await brimServiceRequest(priorityRoute(coreId, terminalId));
      break;
    case "set":
    case "clear":
      response = await brimServiceRequest(priorityRoute(coreId, terminalId), {
        method: action === "set" ? "PUT" : "DELETE",
        headers,
        body,
      });
      break;
    case "import":
      response = await brimServiceRequest("/v1/priorities/import", {
        method: "PUT",
        headers,
        body: coreId ?? "{}",
      });
      break;
    case undefined:
    default:
      throw new Error("Usage: brim metadata list|get|set|clear|import");
  }
  if (!response.ok)
    throw new Error(
      `Brim metadata request failed (${String(response.status)})`,
    );
  const text = await response.text();
  console.log(text.length > 0 ? text : "{}");
}
