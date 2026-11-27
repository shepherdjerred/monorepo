import { describe, expect, test } from "vitest";
import { authorizePipeline } from "#src/authorization.ts";
import {
  CACHE_TRUSTED_ACTORS,
  cacheTrustDomain,
  formatCacheScope,
  type CacheTrustDomain,
} from "#src/pipeline/cache-trust-domain.ts";
import { PipelineSchema } from "#src/schemas.ts";
import { OWNER_AUTHORIZATION } from "#test-identity";
import fixture from "#test-fixtures/woodpecker-v3.18.1-config-request.json" with { type: "json" };

/**
 * Every actor shape the forge can report, with the cache each must reach.
 *
 * `proposal` is a same-repository pull request or canary run; `main` is
 * default-branch work. The expectations are written out rather than derived,
 * so changing the rule means changing this table in review.
 */
const ACTORS: readonly {
  readonly actor: string;
  readonly author: string;
  readonly sender: string;
  readonly fromFork?: boolean;
  readonly proposal: CacheTrustDomain;
  readonly main: CacheTrustDomain;
}[] = [
  {
    actor: "the owner",
    author: "shepherdjerred",
    sender: "shepherdjerred",
    proposal: "trusted",
    main: "trusted",
  },
  {
    actor: "the owner's agent account",
    author: "derrej",
    sender: "derrej",
    proposal: "trusted",
    main: "trusted",
  },
  {
    // A Woodpecker restart copies author and sender (restart.go), so a re-run
    // keeps the original event's identities; this is a new push event.
    actor: "the agent pushing to the owner's PR",
    author: "shepherdjerred",
    sender: "derrej",
    proposal: "trusted",
    main: "trusted",
  },
  {
    actor: "an owner manual run, which has no sender",
    author: "shepherdjerred",
    sender: "",
    proposal: "trusted",
    main: "trusted",
  },
  {
    actor: "the owner's release App",
    author: "long-summer-intern[bot]",
    sender: "long-summer-intern[bot]",
    proposal: "pull-request",
    main: "trusted",
  },
  {
    actor: "the owner's Tracker App",
    author: "justin-principal-engineer[bot]",
    sender: "justin-principal-engineer[bot]",
    proposal: "pull-request",
    main: "trusted",
  },
  {
    actor: "the owner's PR pushed to by an owner App",
    author: "shepherdjerred",
    sender: "long-summer-intern[bot]",
    proposal: "pull-request",
    main: "trusted",
  },
  {
    actor: "Renovate",
    author: "renovate[bot]",
    sender: "renovate[bot]",
    proposal: "pull-request",
    main: "trusted",
  },
  {
    actor: "the owner's PR rebased by Renovate",
    author: "shepherdjerred",
    sender: "renovate[bot]",
    proposal: "pull-request",
    main: "trusted",
  },
  {
    actor: "a Renovate PR re-run by the owner",
    author: "renovate[bot]",
    sender: "shepherdjerred",
    proposal: "pull-request",
    main: "trusted",
  },
  {
    actor: "a fork under the owner's login",
    author: "shepherdjerred",
    sender: "shepherdjerred",
    fromFork: true,
    proposal: "pull-request",
    main: "pull-request",
  },
  {
    actor: "a fork by Renovate",
    author: "renovate[bot]",
    sender: "renovate[bot]",
    fromFork: true,
    proposal: "pull-request",
    main: "pull-request",
  },
  {
    actor: "an unknown account",
    author: "octocat",
    sender: "octocat",
    proposal: "pull-request",
    main: "pull-request",
  },
  {
    actor: "the owner's PR triggered by an unknown account",
    author: "shepherdjerred",
    sender: "octocat",
    proposal: "pull-request",
    main: "pull-request",
  },
  {
    actor: "an unknown account's PR re-run by the owner",
    author: "octocat",
    sender: "shepherdjerred",
    proposal: "pull-request",
    main: "pull-request",
  },
  {
    actor: "a cron, which has neither author nor sender",
    author: "",
    sender: "",
    proposal: "pull-request",
    main: "pull-request",
  },
];

const EVENTS = [
  { event: "proposal", proposal: true, credentialless: false },
  { event: "credentialless proposal", proposal: true, credentialless: true },
  { event: "main", proposal: false, credentialless: false },
  { event: "credentialless main", proposal: false, credentialless: true },
] as const;

function pipeline(overrides: Record<string, unknown>) {
  return PipelineSchema.parse({ ...fixture.pipeline, ...overrides });
}

/** Resolve a pipeline the way `app.ts` does: authorize it, then decide. */
function resolve(
  event: { readonly proposal: boolean; readonly credentialless: boolean },
  overrides: Record<string, unknown>,
) {
  const parsed = pipeline(overrides);
  return cacheTrustDomain({
    ...event,
    authorization: authorizePipeline(parsed),
    pipeline: parsed,
  });
}

const PULL_REQUEST = { proposal: true, credentialless: false } as const;

describe("cache trust domain", () => {
  test.each(
    ACTORS.flatMap((row) =>
      EVENTS.map((event) => ({
        ...row,
        ...event,
        // Credentialless automation holds no cache credential to sign with.
        expected: event.credentialless
          ? "pull-request"
          : row[event.proposal ? "proposal" : "main"],
      })),
    ),
  )(
    "$event by $actor uses the $expected cache",
    ({
      author,
      sender,
      fromFork = false,
      proposal,
      credentialless,
      expected,
    }) => {
      expect(
        resolve(
          { proposal, credentialless },
          { author, sender, from_fork: fromFork },
        ),
      ).toBe(expected);
    },
  );

  test("reads forge identity, never branch names, commit messages or PR text", () => {
    expect(
      resolve(PULL_REQUEST, {
        branch: "main",
        refspec: "shepherdjerred/feature:main",
        message: "Authored by shepherdjerred",
        title: "shepherdjerred: trusted change",
        variables: { CI_ACTOR: "shepherdjerred" },
        author: "renovate[bot]",
        sender: "renovate[bot]",
      }),
    ).toBe("pull-request");
    expect(
      resolve(PULL_REQUEST, {
        refspec: "renovate/hono-4.x:main",
        message: "chore(deps): update renovate[bot] config",
        title: "chore(deps): renovate[bot]",
      }),
    ).toBe("trusted");
  });

  /**
   * Admitting an account to run CI and letting it write main's cache are
   * separate decisions. Widening this list is a reviewed change to what can
   * write entries main loads.
   */
  test("names exactly the accounts whose proposals write main's cache", () => {
    expect(CACHE_TRUSTED_ACTORS).toEqual(["shepherdjerred", "derrej"]);
    // An account later admitted as owner-controlled gains no cache write.
    expect(
      cacheTrustDomain({
        ...PULL_REQUEST,
        authorization: OWNER_AUTHORIZATION,
        pipeline: pipeline({ author: "new-agent", sender: "new-agent" }),
      }),
    ).toBe("pull-request");
  });
});

describe("formatter cache scope", () => {
  test.each([
    { main: true, trustDomain: "trusted", scope: "main" },
    { main: false, trustDomain: "trusted", scope: "none" },
    { main: false, trustDomain: "pull-request", scope: "pr" },
    { main: true, trustDomain: "pull-request", scope: "pr" },
  ] as const)(
    "main=$main in the $trustDomain domain mounts $scope",
    ({ main, trustDomain, scope }) => {
      expect(formatCacheScope({ main, trustDomain })).toBe(scope);
    },
  );
});
