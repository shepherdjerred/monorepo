import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CapacityViewSchema } from "#shared/capacity/view.ts";
import { UserSchema } from "#shared/contract.ts";
import { ApiError } from "#client/api.ts";
import { CapacityMeasurements, CapacityPanel } from "./panel.tsx";

const observedAt = "2026-10-17T15:00:00.000Z";
const current = {
  state: "current",
  reason: null,
  sampledAt: observedAt,
  totalBytes: "9223372036854775807",
  availableBytes: "9007199254740993",
};

function view(samplingEnabled = true) {
  return CapacityViewSchema.parse({
    schemaVersion: 1,
    samplingEnabled,
    asOf: observedAt,
    roles: [
      { role: "movies", ...current },
      { role: "tv", ...current, availableBytes: "0" },
    ],
  });
}

test.each([true, false])(
  "valid measured bytes remain exact with collection enabled=%s",
  (enabled) => {
    const html = renderToStaticMarkup(
      <CapacityMeasurements view={view(enabled)} />,
    );
    expect(html).toContain("9,007,199,254,740,993 bytes");
    expect(html).toContain("9,223,372,036,854,775,807 bytes");
    expect(html).toContain("0 bytes");
    expect(html).toContain("Movies");
    expect(html).toContain("TV");
    expect(html.includes("Capacity collection is off.")).toBe(!enabled);
    expect(html).not.toContain("18,446,744,073,709,551,614");
  },
);

test.each([
  { state: "missing", reason: "sample_missing", message: "Not measured" },
  { state: "stale", reason: "sample_stale", message: "Stale measurement" },
  {
    state: "unavailable",
    reason: "statfs_failed",
    message: "could not be measured",
  },
  { state: "future", reason: "sample_future", message: "Time check required" },
  {
    state: "old_epoch",
    reason: "epoch_changed",
    message: "current recovery state",
  },
  {
    state: "root_changed",
    reason: "binding_changed",
    message: "different storage connection",
  },
])(
  "$state reports its reason without inventing zero capacity",
  ({ state, reason, message }) => {
    const data = CapacityViewSchema.parse({
      ...view(false),
      roles: ["movies", "tv"].map((role) => ({
        role,
        state,
        reason,
        sampledAt: state === "stale" ? observedAt : null,
        totalBytes: null,
        availableBytes: null,
      })),
    });
    const html = renderToStaticMarkup(<CapacityMeasurements view={data} />);
    expect(html).toContain(message);
    expect(html).toContain("Capacity collection is off.");
    expect(html).not.toContain(" bytes");
  },
);

test("members and restricted owners never render cached owner measurements", () => {
  const client = new QueryClient();
  try {
    for (const authority of [
      { role: "member", restricted: false },
      { role: "owner", restricted: true },
    ]) {
      const user = UserSchema.parse({
        id: crypto.randomUUID(),
        plexAccountId: "123",
        displayName: "Viewer",
        version: 0,
        ...authority,
      });
      client.setQueryData(["capacity", user.id], view());
      expect(
        renderToStaticMarkup(
          <QueryClientProvider client={client}>
            <CapacityPanel user={user} />
          </QueryClientProvider>,
        ),
      ).toBe("");
    }
  } finally {
    client.clear();
  }
});

test("an authoritative owner denial hides an earlier cached measurement", () => {
  const client = new QueryClient();
  const user = UserSchema.parse({
    id: crypto.randomUUID(),
    plexAccountId: "123",
    displayName: "Owner",
    version: 0,
    role: "owner",
    restricted: false,
  });
  try {
    const key = ["capacity", user.id];
    client.setQueryData(key, view());
    const query = client.getQueryCache().find({ queryKey: key });
    if (query === undefined) throw new Error("Expected cached query");
    query.setState({
      status: "error",
      error: new ApiError("owner_required", "Owner access required", 403),
      fetchStatus: "idle",
    });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <CapacityPanel user={user} />
      </QueryClientProvider>,
    );
    expect(html).toContain("Owner access required");
    expect(html).not.toContain("9,007,199,254,740,993");
    expect(html).not.toContain("Current measurement");
    expect(html).toContain("should not be added together");
    expect(html).toContain("do not reserve space");
  } finally {
    client.clear();
  }
});
