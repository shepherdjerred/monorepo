import { expect, test, vi } from "vitest";
import type { ConnectionStateListener } from "@shepherdjerred/home-assistant";
import { trackEventBridgeConnection } from "./connection-health.ts";

test("health requires initial subscriptions and restored subscriptions on reconnect", () => {
  let listener: ConnectionStateListener | undefined;
  const removeListener = vi.fn();
  const gauge = { set: vi.fn() };
  const health = trackEventBridgeConnection(
    {
      onConnectionChange: (callback) => {
        listener = callback;
        return removeListener;
      },
    },
    gauge,
  );
  listener?.("authenticated");
  listener?.("ready");
  expect(gauge.set).toHaveBeenLastCalledWith(0);
  health.subscriptionsStarted();
  expect(gauge.set).toHaveBeenLastCalledWith(1);
  listener?.("handler-error", new Error("consumer failed"));
  expect(gauge.set).toHaveBeenLastCalledWith(1);
  listener?.("closed");
  expect(gauge.set).toHaveBeenLastCalledWith(0);
  listener?.("authenticated");
  expect(gauge.set).toHaveBeenLastCalledWith(0);
  listener?.("error");
  expect(gauge.set).toHaveBeenLastCalledWith(0);
  listener?.("ready");
  expect(gauge.set).toHaveBeenLastCalledWith(1);
  health.stop();
  expect(gauge.set).toHaveBeenLastCalledWith(0);
  expect(removeListener).toHaveBeenCalledOnce();
});

test("a disconnect while initial subscriptions finish cannot restore health", () => {
  let listener: ConnectionStateListener | undefined;
  const gauge = { set: vi.fn() };
  const health = trackEventBridgeConnection(
    {
      onConnectionChange: (callback) => {
        listener = callback;
        return vi.fn();
      },
    },
    gauge,
  );
  listener?.("ready");
  listener?.("closed");
  health.subscriptionsStarted();
  expect(gauge.set).toHaveBeenLastCalledWith(0);
  health.stop();
});
