import { describe, expect, test } from "bun:test";
import {
  exploreShareLink,
  mintedAfterPersisted,
  resolveShareToken,
} from "#src/lib/explore-share-link.ts";

const ORIGIN = "https://scout-for-lol.com";
const PERSISTED = "persisted-token";
const MINTED = "minted-token";

describe("resolveShareToken", () => {
  test("shows the token the share just minted before the query reports it", () => {
    // The regression: sharing invalidates the transcript query and reads the
    // token back over the network. Deriving the link from the read-back alone
    // renders nothing until that lands — and nothing at all if it fails, so a
    // share that succeeded shows no link and no clipboard acknowledgement.
    expect(resolveShareToken({ persisted: null, minted: MINTED })).toBe(MINTED);
  });

  test("prefers the persisted token once the query reports one", () => {
    // Not cosmetic: the persisted value is what a revocation elsewhere clears,
    // so it has to win wherever both exist.
    expect(resolveShareToken({ persisted: PERSISTED, minted: MINTED })).toBe(
      PERSISTED,
    );
  });

  test("shows nothing when the conversation has never been shared", () => {
    expect(resolveShareToken({ persisted: null, minted: null })).toBeNull();
  });
});

describe("mintedAfterPersisted", () => {
  test("drops the bridge once the query reports the token", () => {
    expect(
      mintedAfterPersisted({ minted: MINTED, persisted: PERSISTED }),
    ).toBeNull();
  });

  test("keeps the bridge while the query still reports nothing", () => {
    expect(mintedAfterPersisted({ minted: MINTED, persisted: null })).toBe(
      MINTED,
    );
  });

  // Together with the drop above, this is what stops the bridge outliving a
  // revocation: by the time a share can be revoked the query has reported it,
  // so the bridge is already gone and `persisted` turning null clears the link.
  test("a revoked share leaves no link once the bridge has been dropped", () => {
    const afterReadBack = mintedAfterPersisted({
      minted: MINTED,
      persisted: PERSISTED,
    });
    expect(
      resolveShareToken({ persisted: null, minted: afterReadBack }),
    ).toBeNull();
  });
});

describe("exploreShareLink", () => {
  test("builds the shared-conversation URL for a token", () => {
    expect(exploreShareLink(ORIGIN, PERSISTED)).toBe(
      `${ORIGIN}/app/explore/s/${PERSISTED}`,
    );
  });

  test("has no link without a token", () => {
    expect(exploreShareLink(ORIGIN, null)).toBeNull();
  });
});
