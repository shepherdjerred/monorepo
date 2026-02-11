import { LolApi, RiotApi } from "twisted";
import configuration from "@shepherdjerred/scout-backend/configuration.ts";

export const api = new LolApi({
  key: configuration.riotApiToken,
  rateLimitRetry: true,
  rateLimitRetryAttempts: 3,
  concurrency: 1,
});

export const riotApi = new RiotApi({
  key: configuration.riotApiToken,
  rateLimitRetry: true,
  rateLimitRetryAttempts: 3,
  concurrency: 1,
});
