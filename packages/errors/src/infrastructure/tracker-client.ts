import { z } from "zod";
import type { FetchLike } from "#infrastructure/bugsink-importer.ts";
import type { CreateTrackerIssueInput } from "#shared/contract.ts";

const TrackerTrpcCreateResponseSchema = z.object({
  result: z.object({
    data: z.object({
      identifier: z.string().min(1),
    }),
  }),
});

export type CreateTrackerIssueRequest = {
  readonly title: string;
  readonly description: string;
  readonly urgency: CreateTrackerIssueInput["urgency"];
  readonly impact: CreateTrackerIssueInput["impact"];
  readonly effort: CreateTrackerIssueInput["effort"];
};

export type CreatedTrackerIssueLink = {
  readonly identifier: string;
  readonly url: string;
};

export type TrackerIssueClient = {
  readonly createIssue: (
    request: CreateTrackerIssueRequest,
  ) => Promise<CreatedTrackerIssueLink>;
  readonly issueUrlForIdentifier: (identifier: string) => string;
};

export function createTrackerIssueClient(options: {
  readonly apiUrl: string;
  readonly publicUrl: string;
  readonly fetchFn?: FetchLike | undefined;
}): TrackerIssueClient {
  const apiBase = z.url().parse(options.apiUrl).replace(/\/+$/u, "");
  const publicBase = z.url().parse(options.publicUrl).replace(/\/+$/u, "");
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  const issueUrlForIdentifier = (identifier: string): string =>
    `${publicBase}/AI/issues/${encodeURIComponent(identifier)}`;

  return {
    issueUrlForIdentifier,
    createIssue: async (request) => {
      const response = await fetchFn(`${apiBase}/trpc/issues.create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          actor: {
            kind: "service",
            key: "service:errors",
            name: "Errors",
          },
          teamKey: "AI",
          title: request.title,
          description: request.description,
          urgency: request.urgency,
          impact: request.impact,
          effort: request.effort,
          labels: ["Bug"],
        }),
        signal: AbortSignal.timeout(20_000),
      });

      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(
          `Tracker issues.create failed (${String(response.status)}): ${bodyText.slice(0, 300)}`,
        );
      }
      const rawJson: unknown = JSON.parse(bodyText);
      const parsed = TrackerTrpcCreateResponseSchema.parse(rawJson);
      const identifier = parsed.result.data.identifier;
      return {
        identifier,
        url: issueUrlForIdentifier(identifier),
      };
    },
  };
}
