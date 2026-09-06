import { renderToStaticMarkup } from "react-dom/server";
import { Loaded } from "@shepherdjerred/loaded";
import { describe, expect, test } from "vitest";
import { WalletPanel, type WalletData } from "#src/routes/bucks-overview.tsx";

const noop = () => {
  /* render-only tests never submit */
};

const settled: WalletData = {
  wallet: { balance: 10, totalAtRisk: 0, pendingPositionCount: 0 },
  eligible: true,
};

describe("WalletPanel", () => {
  test("shows a loading state instead of the wallet card while pending", () => {
    const html = renderToStaticMarkup(
      <WalletPanel
        wallet={Loaded.loading()}
        onRetry={noop}
        onCancelOutcome={noop}
      />,
    );
    expect(html).not.toContain("tracked");
    expect(html).not.toContain("No wallet yet");
  });

  test("shows a retryable error instead of misreporting eligibility", () => {
    const html = renderToStaticMarkup(
      <WalletPanel
        wallet={Loaded.failed(new Error("wallet unavailable"))}
        onRetry={noop}
        onCancelOutcome={noop}
      />,
    );
    expect(html).toContain("couldn&#x27;t load");
    // A failed wallet fetch must never render the "not eligible" copy.
    expect(html).not.toContain("Only players tracked");
  });

  test("renders the wallet card once the query settles", () => {
    const html = renderToStaticMarkup(
      <WalletPanel
        wallet={Loaded.done(settled)}
        onRetry={noop}
        onCancelOutcome={noop}
      />,
    );
    expect(html).toContain("Your Bryan Bucks");
  });

  test("keeps the balance on screen when a refresh fails", () => {
    // The state the old `isPending`/`isError` pair could not express: an error
    // arriving over a wallet already in hand. It used to check `isError` first
    // and replace a usable balance with a retry card.
    const html = renderToStaticMarkup(
      <WalletPanel
        wallet={Loaded.degraded(settled, [
          { path: ["bucks.wallet"], error: new Error("refresh failed") },
        ])}
        onRetry={noop}
        onCancelOutcome={noop}
      />,
    );
    expect(html).toContain("Your Bryan Bucks");
    expect(html).toContain("most recent refresh failed");
    expect(html).not.toContain("couldn&#x27;t load");
  });
});
