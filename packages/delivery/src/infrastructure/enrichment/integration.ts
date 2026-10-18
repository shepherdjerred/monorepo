import { UpstreamError } from "@shepherdjerred/ops-clients/http.ts";
import type { Link } from "@shepherdjerred/ops-model/snapshot.ts";
import { z } from "zod";
import type { UnavailableReason } from "#shared/hub/integration-contract.ts";

export type Unavailable = {
  state: "unavailable";
  reason: UnavailableReason;
  detail: string;
  links: Link[];
};
export type Available<T> = {
  state: "available";
  data: T;
  fetchedAt: string;
  links: Link[];
};

export function unavailable(
  reason: UnavailableReason,
  detail: string,
  links: Link[],
): Unavailable {
  return { state: "unavailable", reason, detail, links };
}

/** A bounded, payload-free description of why an upstream read failed. */
export function failure(error: unknown, links: Link[]): Unavailable {
  if (error instanceof DOMException && error.name === "TimeoutError")
    return unavailable("timeout", "The upstream did not answer in time", links);
  if (error instanceof UpstreamError)
    return unavailable("upstream-error", error.message, links);
  if (error instanceof z.ZodError)
    return unavailable(
      "upstream-error",
      "The upstream answered with an unexpected shape",
      links,
    );
  throw error;
}
