import { describe, expect, test } from "bun:test";
import {
  branchName,
  collectErrorMessages,
  dataDragonPrTitle,
  findDataDragonPr,
  isDataDragonBranch,
  isDataDragonPrAuthor,
  isFinalAttempt,
  type OpenPrCandidate,
  resolveTerminalFailureReason,
} from "./data-dragon-util.ts";

// The GitHub App slug the updater runs as; `gh pr list --json author` renders
// its bot login as `app/<slug>`.
const APP_SLUG = "long-summer-intern";

// A well-formed PR the bot itself opened for the given version: exact title,
// base main, same-repo head, generated branch shape, authored by the app bot.
// Tests override one field at a time to prove each authentication check
// rejects a spoof.
function botPr(
  version: string,
  overrides: Partial<OpenPrCandidate> = {},
): OpenPrCandidate {
  return {
    title: dataDragonPrTitle(version),
    url: "https://github.com/shepherdjerred/monorepo/pull/1",
    baseRefName: "main",
    headRefName: `chore/scout-data-dragon-${version}-6d94e121`,
    isCrossRepository: false,
    author: { is_bot: true, login: `app/${APP_SLUG}` },
    ...overrides,
  };
}

describe("isFinalAttempt", () => {
  test("returns false before the final attempt", () => {
    expect(isFinalAttempt(1, 2)).toBe(false);
  });

  test("returns true at the final attempt", () => {
    expect(isFinalAttempt(2, 2)).toBe(true);
  });

  test("returns true past the configured max (defensive)", () => {
    expect(isFinalAttempt(3, 2)).toBe(true);
  });

  test("returns true on the only attempt when maxAttempts is 1", () => {
    expect(isFinalAttempt(1, 1)).toBe(true);
  });
});

describe("branchName", () => {
  test("is deterministic per version (no random suffix)", () => {
    expect(branchName("16.15.1")).toBe("chore/scout-data-dragon-16.15.1");
    expect(branchName("16.15.1")).toBe(branchName("16.15.1"));
  });
});

describe("isDataDragonBranch", () => {
  test("matches the current deterministic per-version branch", () => {
    expect(isDataDragonBranch(branchName("16.15.1"), "16.15.1")).toBe(true);
    expect(
      isDataDragonBranch("chore/scout-data-dragon-16.15.1", "16.15.1"),
    ).toBe(true);
  });

  test("matches the legacy random-suffixed branch shape", () => {
    expect(
      isDataDragonBranch("chore/scout-data-dragon-16.15.1-6d94e121", "16.15.1"),
    ).toBe(true);
  });

  test("does not match a different version's deterministic branch", () => {
    expect(
      isDataDragonBranch("chore/scout-data-dragon-16.15.10", "16.15.1"),
    ).toBe(false);
  });

  test("rejects a wrong-version branch", () => {
    expect(
      isDataDragonBranch("chore/scout-data-dragon-16.15.0-6d94e121", "16.15.1"),
    ).toBe(false);
  });

  test("rejects a non-hex / wrong-length suffix", () => {
    expect(
      isDataDragonBranch("chore/scout-data-dragon-16.15.1-zzzzzzzz", "16.15.1"),
    ).toBe(false);
    expect(
      isDataDragonBranch("chore/scout-data-dragon-16.15.1-6d94e1", "16.15.1"),
    ).toBe(false);
  });

  test("rejects an unrelated branch name", () => {
    expect(isDataDragonBranch("main", "16.15.1")).toBe(false);
    expect(isDataDragonBranch("feature/whatever", "16.15.1")).toBe(false);
  });
});

describe("isDataDragonPrAuthor", () => {
  test("accepts the app bot in gh's app/<slug> form", () => {
    expect(
      isDataDragonPrAuthor(
        { is_bot: true, login: `app/${APP_SLUG}` },
        APP_SLUG,
      ),
    ).toBe(true);
  });

  test("accepts the app bot in the <slug>[bot] form", () => {
    expect(
      isDataDragonPrAuthor(
        { is_bot: true, login: `${APP_SLUG}[bot]` },
        APP_SLUG,
      ),
    ).toBe(true);
  });

  test("rejects a human collaborator whose login happens to match the slug", () => {
    // is_bot is set by GitHub, not the PR opener — a collaborator can't fake
    // it, so even a login collision is rejected.
    expect(
      isDataDragonPrAuthor({ is_bot: false, login: APP_SLUG }, APP_SLUG),
    ).toBe(false);
  });

  test("rejects a different bot", () => {
    expect(
      isDataDragonPrAuthor({ is_bot: true, login: "app/renovate" }, APP_SLUG),
    ).toBe(false);
  });
});

describe("findDataDragonPr", () => {
  test("returns the bot's authenticated PR for the target version", () => {
    const match = botPr("16.15.1");
    expect(
      findDataDragonPr(
        [botPr("16.15.1", { title: "chore: something unrelated" }), match],
        "16.15.1",
        APP_SLUG,
      ),
    ).toBe(match);
  });

  test("returns undefined for a PR targeting a different version", () => {
    expect(
      findDataDragonPr([botPr("16.15.0")], "16.15.1", APP_SLUG),
    ).toBeUndefined();
  });

  test("rejects a same-title PR from a fork (isCrossRepository)", () => {
    // The spoof: a contributor opens a same-title PR from their fork. The head
    // repository can't be faked, so isCrossRepository authenticates it out.
    expect(
      findDataDragonPr(
        [botPr("16.15.1", { isCrossRepository: true })],
        "16.15.1",
        APP_SLUG,
      ),
    ).toBeUndefined();
  });

  test("rejects a same-title PR against a different base", () => {
    expect(
      findDataDragonPr(
        [botPr("16.15.1", { baseRefName: "beta" })],
        "16.15.1",
        APP_SLUG,
      ),
    ).toBeUndefined();
  });

  test("rejects a same-title PR whose head branch isn't the generated shape", () => {
    expect(
      findDataDragonPr(
        [botPr("16.15.1", { headRefName: "attacker/pwn" })],
        "16.15.1",
        APP_SLUG,
      ),
    ).toBeUndefined();
  });

  test("rejects a collaborator's look-alike PR authored by a human", () => {
    // A repository collaborator with push access can craft a same-repo branch
    // of the generated shape with the exact title and base — every field
    // except the author matches. The bot-identity check stops the updater from
    // auto-merging it.
    expect(
      findDataDragonPr(
        [botPr("16.15.1", { author: { is_bot: false, login: "mallory" } })],
        "16.15.1",
        APP_SLUG,
      ),
    ).toBeUndefined();
  });

  test("rejects an otherwise-perfect PR authored by a different bot", () => {
    expect(
      findDataDragonPr(
        [botPr("16.15.1", { author: { is_bot: true, login: "app/renovate" } })],
        "16.15.1",
        APP_SLUG,
      ),
    ).toBeUndefined();
  });

  test("returns undefined on an empty PR list", () => {
    expect(findDataDragonPr([], "16.15.1", APP_SLUG)).toBeUndefined();
  });
});

describe("collectErrorMessages", () => {
  test("joins the message and its cause-chain messages", () => {
    const inner = new Error("Command failed (git push origin): exit 1");
    const outer = new Error("Activity task failed", { cause: inner });
    expect(collectErrorMessages(outer)).toBe(
      "Activity task failed | Command failed (git push origin): exit 1",
    );
  });

  test("returns a single message when there is no cause", () => {
    expect(collectErrorMessages(new Error("boom"))).toBe("boom");
  });

  test("returns an empty string for a non-error value", () => {
    expect(collectErrorMessages("not an error")).toBe("");
  });

  test("does not loop on a self-referential cause chain", () => {
    const err = new Error("self");
    Object.defineProperty(err, "cause", { value: err });
    expect(collectErrorMessages(err)).toBe("self");
  });
});

describe("resolveTerminalFailureReason", () => {
  test("extracts the granular reason from a wrapped ActivityFailure chain", () => {
    // Mirrors how Temporal surfaces a failed activity to the workflow: a
    // top-level ActivityFailure whose cause carries the original command
    // message. The reason must come from the buried cause, not the wrapper.
    const activityFailure = new Error("Activity task failed", {
      cause: new Error(
        "Command failed (gh pr create --repo shepherdjerred/monorepo): exit 1 <redacted>",
      ),
    });
    expect(resolveTerminalFailureReason(activityFailure)).toBe(
      "pr-create-failed",
    );
  });

  test("labels a buried git push failure", () => {
    const failure = new Error("Activity task failed", {
      cause: new Error("Command failed (git push --force-with-lease): exit 1"),
    });
    expect(resolveTerminalFailureReason(failure)).toBe("git-push-failed");
  });

  test("falls through to exception for a message-less OOM/timeout kill", () => {
    // A worker killed by OOM / heartbeat timeout carries no granular command
    // message — the reason filter should not match, and the generic
    // ScoutDataDragonUpdateFailed alert covers it.
    expect(
      resolveTerminalFailureReason(new Error("activity StartToClose timeout")),
    ).toBe("exception");
  });
});
