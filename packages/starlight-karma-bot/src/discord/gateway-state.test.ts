import { beforeEach, describe, expect, test } from "bun:test";
import {
  GATEWAY_GRACE_MS,
  gatewayDownForMs,
  isGatewayConnected,
  isLive,
  markGatewayConnected,
  markGatewayDisconnected,
  resetGatewayStateForTest,
} from "./gateway-state.ts";

describe("isLive", () => {
  test("is live while within the grace window", () => {
    expect(isLive(0)).toBe(true);
    expect(isLive(GATEWAY_GRACE_MS - 1)).toBe(true);
  });

  test("is not live once the grace window elapses", () => {
    expect(isLive(GATEWAY_GRACE_MS)).toBe(false);
    expect(isLive(GATEWAY_GRACE_MS * 2)).toBe(false);
  });
});

describe("gateway state", () => {
  beforeEach(() => {
    resetGatewayStateForTest(null);
  });

  test("a connected gateway has zero downtime", () => {
    markGatewayConnected();
    expect(isGatewayConnected()).toBe(true);
    expect(gatewayDownForMs()).toBe(0);
  });

  test("downtime is measured from the disconnect", () => {
    markGatewayDisconnected(1000);
    expect(isGatewayConnected()).toBe(false);
    expect(gatewayDownForMs(4000)).toBe(3000);
  });

  test("repeated disconnects keep the earliest timestamp", () => {
    // Otherwise a flapping gateway would reset the grace window on every
    // event and the pod would never be restarted.
    markGatewayDisconnected(1000);
    markGatewayDisconnected(2000);
    markGatewayDisconnected(3000);
    expect(gatewayDownForMs(4000)).toBe(3000);
  });

  test("reconnecting clears the downtime", () => {
    markGatewayDisconnected(1000);
    markGatewayConnected();
    expect(gatewayDownForMs(9999)).toBe(0);
  });

  test("a gateway that never connected counts as down", () => {
    // Module-load default: a first login that never succeeds must eventually
    // fail liveness rather than report healthy forever.
    resetGatewayStateForTest(0);
    expect(isGatewayConnected()).toBe(false);
    expect(isLive(gatewayDownForMs(GATEWAY_GRACE_MS + 1))).toBe(false);
  });
});
