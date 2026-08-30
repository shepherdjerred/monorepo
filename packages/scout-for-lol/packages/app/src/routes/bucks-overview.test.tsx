import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { WalletPanel } from "#src/routes/bucks-overview.tsx";

const noop = () => {
  /* render-only tests never submit */
};

describe("WalletPanel", () => {
  test("shows a loading state instead of the wallet card while pending", () => {
    const html = renderToStaticMarkup(
      <WalletPanel
        isPending={true}
        isError={false}
        onRetry={noop}
        wallet={undefined}
        eligible={false}
        pendingPositions={[]}
        onCancelOutcome={noop}
      />,
    );
    expect(html).not.toContain("tracked");
    expect(html).not.toContain("No wallet yet");
  });

  test("shows a retryable error instead of misreporting eligibility", () => {
    const html = renderToStaticMarkup(
      <WalletPanel
        isPending={false}
        isError={true}
        onRetry={noop}
        wallet={undefined}
        eligible={false}
        pendingPositions={[]}
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
        isPending={false}
        isError={false}
        onRetry={noop}
        wallet={{ balance: 10, totalAtRisk: 0, pendingPositionCount: 0 }}
        eligible={true}
        pendingPositions={[]}
        onCancelOutcome={noop}
      />,
    );
    expect(html).toContain("Your Bryan Bucks");
  });
});
