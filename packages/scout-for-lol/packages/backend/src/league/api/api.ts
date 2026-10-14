import configuration from "#src/configuration.ts";
import { RiotClient } from "./client/riot-client.ts";
import { captureRiotResponse } from "#src/evidence/raw-riot.ts";

export const riotClient = new RiotClient({
  apiKey: configuration.riotApiToken,
  concurrency: 5,
  maxRetries: 3,
  onPayload: captureRiotResponse,
});
