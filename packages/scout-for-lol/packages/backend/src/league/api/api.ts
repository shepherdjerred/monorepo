import { LolApi, RiotApi } from "twisted";
import configuration from "@scout-for-lol/backend/configuration.ts";

export const api = new LolApi({
  key: configuration.riotApiToken,
  rateLimitRetry: true,
  rateLimitRetryAttempts: 3,
  concurrency: 5,
});

export const riotApi = new RiotApi({
  key: configuration.riotApiToken,
  rateLimitRetry: true,
  rateLimitRetryAttempts: 3,
  concurrency: 5,
});
