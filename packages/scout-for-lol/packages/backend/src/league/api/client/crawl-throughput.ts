/** Pure capacity arithmetic for the participant crawl's spare Riot rate. */

const SECONDS_PER_DAY = 86_400;

export type CrawlThroughput = {
  requestsPerSecond: number;
  requestsPerDay: number;
  /** Present only when `requestsPerMatch` was given. */
  matchesPerDay?: number;
};

/**
 * Crawl throughput on one routing host: the ceiling share of the host's
 * sustained request rate. `requestsPerMatch` is the average number of Riot
 * calls one crawled match costs (match, sampled timeline, rank lookups).
 */
export function crawlThroughput(input: {
  ceiling: number;
  hostRequestsPerSecond: number;
  requestsPerMatch?: number;
}): CrawlThroughput {
  const requestsPerSecond = input.ceiling * input.hostRequestsPerSecond;
  const requestsPerDay = requestsPerSecond * SECONDS_PER_DAY;
  return input.requestsPerMatch === undefined
    ? { requestsPerSecond, requestsPerDay }
    : {
        requestsPerSecond,
        requestsPerDay,
        matchesPerDay: requestsPerDay / input.requestsPerMatch,
      };
}
