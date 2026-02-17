import { LolApi } from "npm:twisted@1.57.0";
import configuration from "../../configuration.ts";

export const api = new LolApi({
  key: configuration.riotApiToken,
  rateLimitRetry: true,
  rateLimitRetryAttempts: 3,
  concurrency: 1,
});
