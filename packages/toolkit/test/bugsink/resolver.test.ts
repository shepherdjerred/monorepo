import { afterEach, describe, expect, it } from "vitest";
import { buildIssueResolvePayload, resolveIssue } from "#lib/bugsink/issues.ts";
import { formatResolveResult } from "#commands/bugsink/resolve.ts";
import type { BugsinkIssue } from "#lib/bugsink/types.ts";
import {
  normalizeBugsinkIssueIds,
  parseBugsinkIssueIds,
  resolveIssues,
  type BugsinkIssueResolverApi,
} from "#lib/bugsink/resolver.ts";
import { captureBugsinkEnvironment } from "./test-helpers.ts";

const ISSUE_ID = "311e191f-5e83-4524-a5b5-d1d1d08581fa";
const SECOND_ISSUE_ID = "fa406347-79cf-4f94-8b2d-afce20eb2d41";
const bugsinkEnvironment = captureBugsinkEnvironment();
type FetchInput = Parameters<typeof fetch>[0];

function issue(overrides: Partial<BugsinkIssue> = {}): BugsinkIssue {
  return {
    id: ISSUE_ID,
    project: 3,
    digest_order: 16,
    last_seen: "2026-08-24T00:00:00Z",
    first_seen: "2026-08-23T00:00:00Z",
    digested_event_count: 4,
    stored_event_count: 4,
    calculated_type: "Error",
    calculated_value: "Example failure",
    transaction: "worker.run",
    is_resolved: false,
    is_resolved_by_next_release: false,
    is_muted: false,
    ...overrides,
  };
}

function resolverApi(
  issues: Map<string, BugsinkIssue | null>,
  events: string[],
): BugsinkIssueResolverApi {
  return {
    getIssue: async (issueId) => {
      events.push(`get:${issueId}`);
      return issues.get(issueId) ?? null;
    },
    resolveIssue: async (currentIssue) => {
      events.push(`post:${currentIssue.id}`);
    },
  };
}

afterEach(() => {
  bugsinkEnvironment.restore();
});

describe("Bugsink issue target parsing", () => {
  it("validates and deduplicates UUIDs from arguments and files", () => {
    expect(
      parseBugsinkIssueIds([ISSUE_ID], `\n${ISSUE_ID}\n${SECOND_ISSUE_ID}\n`),
    ).toEqual([ISSUE_ID, SECOND_ISSUE_ID]);
    expect(normalizeBugsinkIssueIds([ISSUE_ID, ISSUE_ID])).toEqual([ISSUE_ID]);
  });

  it("rejects malformed UUIDs before any API access", () => {
    expect(() => parseBugsinkIssueIds(["not-an-issue"])).toThrow(
      "Invalid Bugsink issue UUID",
    );
  });
});

describe("Bugsink issue resolver", () => {
  it("does not POST when any target fails preflight", async () => {
    const events: string[] = [];
    const result = await resolveIssues([ISSUE_ID, SECOND_ISSUE_ID], {
      confirm: true,
      api: resolverApi(
        new Map([
          [ISSUE_ID, issue()],
          [SECOND_ISSUE_ID, null],
        ]),
        events,
      ),
    });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual([
      { id: SECOND_ISSUE_ID, message: "Issue not found" },
    ]);
    expect(events).toEqual([`get:${ISSUE_ID}`, `get:${SECOND_ISSUE_ID}`]);
  });

  it("refuses muted issues without POSTing", async () => {
    const events: string[] = [];
    const result = await resolveIssues([ISSUE_ID], {
      confirm: true,
      api: resolverApi(
        new Map([[ISSUE_ID, issue({ is_muted: true })]]),
        events,
      ),
    });

    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toBe("Issue is muted");
    expect(events).toEqual([`get:${ISSUE_ID}`]);
  });

  it("previews without confirmation and skips already resolved issues", async () => {
    const events: string[] = [];
    const result = await resolveIssues([ISSUE_ID, SECOND_ISSUE_ID], {
      api: resolverApi(
        new Map([
          [ISSUE_ID, issue()],
          [SECOND_ISSUE_ID, issue({ id: SECOND_ISSUE_ID, is_resolved: true })],
        ]),
        events,
      ),
    });

    expect(result).toMatchObject({
      success: true,
      dryRun: true,
      eligible: [ISSUE_ID],
      skipped: [SECOND_ISSUE_ID],
      resolved: [],
    });
    expect(events).toEqual([`get:${ISSUE_ID}`, `get:${SECOND_ISSUE_ID}`]);
  });

  it("verifies each POST and stops on the first runtime failure", async () => {
    const events: string[] = [];
    const api: BugsinkIssueResolverApi = {
      getIssue: async (issueId) => {
        events.push(`get:${issueId}`);
        return issue({
          id: issueId,
          is_resolved: events.includes(`verified:${issueId}`),
        });
      },
      resolveIssue: async (currentIssue) => {
        events.push(`post:${currentIssue.id}`);
        if (currentIssue.id === SECOND_ISSUE_ID) {
          throw new Error("upstream rejected action");
        }
        events.push(`verified:${currentIssue.id}`);
      },
    };

    const result = await resolveIssues([ISSUE_ID, SECOND_ISSUE_ID], {
      confirm: true,
      api,
    });

    expect(result.success).toBe(false);
    expect(result.resolved).toEqual([ISSUE_ID]);
    expect(result.errors).toEqual([
      { id: SECOND_ISSUE_ID, message: "upstream rejected action" },
    ]);
    expect(events).toEqual([
      `get:${ISSUE_ID}`,
      `get:${SECOND_ISSUE_ID}`,
      `post:${ISSUE_ID}`,
      `verified:${ISSUE_ID}`,
      `get:${ISSUE_ID}`,
      `post:${SECOND_ISSUE_ID}`,
    ]);
  });

  it("rejects a post whose follow-up verification is not resolved", async () => {
    const current = issue();
    const result = await resolveIssues([ISSUE_ID], {
      confirm: true,
      api: {
        getIssue: async () => current,
        resolveIssue: () => Promise.resolve(),
      },
    });

    expect(result.success).toBe(false);
    expect(result.resolved).toEqual([]);
    expect(result.errors[0]?.message).toContain("Verification failed");
  });
});

describe("Bugsink resolve API action", () => {
  it("uses the canonical REST endpoint and complete payload", async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    globalThis.fetch = Object.assign(
      async (input: FetchInput, init?: RequestInit) => {
        requests.push({
          url:
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url,
          init,
        });
        return new Response(null, { status: 204 });
      },
      { preconnect: bugsinkEnvironment.originalFetch.preconnect },
    );
    Bun.env["BUGSINK_URL"] = "https://bugsink.example.test";
    Bun.env["BUGSINK_TOKEN"] = "secret-token";

    const current = issue();
    await resolveIssue(current);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      `https://bugsink.example.test/api/canonical/0/issues/${ISSUE_ID}/resolve/`,
    );
    expect(requests[0]?.init?.method).toBe("POST");
    expect(requests[0]?.init?.headers).toEqual({
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json",
    });
    const requestBody = requests[0]?.init?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") {
      throw new TypeError("Expected a JSON request body");
    }
    expect(JSON.parse(requestBody)).toEqual(buildIssueResolvePayload(current));
  });
});

describe("Bugsink resolve output", () => {
  it("does not include credentials in human output", () => {
    const output = formatResolveResult({
      success: false,
      dryRun: false,
      requested: [ISSUE_ID],
      eligible: [],
      skipped: [],
      resolved: [],
      errors: [{ id: ISSUE_ID, message: "Issue is muted" }],
    });

    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("Authorization");
  });
});
