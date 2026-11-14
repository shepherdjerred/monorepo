import { expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ connect: vi.fn(), client: vi.fn() }));
vi.mock("@temporalio/client", async (original) => ({
  ...(await original<object>()),
  Connection: { connect: sdk.connect },
  Client: vi.fn(function (options: unknown) {
    sdk.client(options);
  }),
}));
import { createTemporalReadClient } from "#client";

it("bounds a requested initial connection without changing defaults or recreating a cached reader", async () => {
  sdk.connect.mockResolvedValue({});
  await createTemporalReadClient("prod", { connectTimeout: 4000 });
  expect(sdk.connect).toHaveBeenLastCalledWith(
    expect.objectContaining({ connectTimeout: 4000 }),
  );
  await createTemporalReadClient("prod", { connectTimeout: 1000 });
  expect(sdk.connect).toHaveBeenCalledTimes(1);
  await createTemporalReadClient("beta");
  expect(sdk.connect).toHaveBeenLastCalledWith({ address: expect.any(String) });
  expect(sdk.client).toHaveBeenCalledTimes(2);
});
