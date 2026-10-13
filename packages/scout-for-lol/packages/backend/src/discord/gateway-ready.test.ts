import { expect, test, vi } from "vitest";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { loginReadyGateway } from "#src/discord/gateway-ready.ts";

function clientFixture() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const login = vi.spyOn(client, "login").mockResolvedValue("test-token");
  return { client, login };
}

function emitReady(client: Client): void {
  vi.spyOn(client, "isReady").mockReturnValue(true);
  if (!client.isReady()) throw new Error("Expected the ready client fixture");
  client.emit(Events.ClientReady, client);
}

test("login acknowledgment waits for the authoritative ready event", async () => {
  const { client, login } = clientFixture();
  let completed = false;
  const operation = (async () => {
    await loginReadyGateway(client, "test-token");
    completed = true;
  })();
  await Promise.resolve();
  expect(login).toHaveBeenCalledOnce();
  expect(completed).toBe(false);
  expect(client.listenerCount(Events.ClientReady)).toBe(1);
  emitReady(client);
  await operation;
  expect(completed).toBe(true);
  expect(client.listenerCount(Events.ClientReady)).toBe(0);
});

test("a ready event during login is observed before login resolves", async () => {
  const { client, login } = clientFixture();
  const acknowledgment = Promise.withResolvers<string>();
  login.mockImplementation(() => {
    emitReady(client);
    return acknowledgment.promise;
  });
  let completed = false;
  const operation = (async () => {
    await loginReadyGateway(client, "test-token");
    completed = true;
  })();
  await Promise.resolve();
  expect(completed).toBe(false);
  acknowledgment.resolve("test-token");
  await operation;
  expect(completed).toBe(true);
  expect(client.listenerCount(Events.ClientReady)).toBe(0);
});

test("login rejection removes the ready listener and propagates the failure", async () => {
  const { client, login } = clientFixture();
  const failure = new Error("login rejected");
  login.mockRejectedValue(failure);
  await expect(loginReadyGateway(client, "test-token")).rejects.toBe(failure);
  expect(client.listenerCount(Events.ClientReady)).toBe(0);
});

test("an already ready client needs no second login", async () => {
  const { client, login } = clientFixture();
  vi.spyOn(client, "isReady").mockReturnValue(true);
  await loginReadyGateway(client, "test-token");
  expect(login).not.toHaveBeenCalled();
  expect(client.listenerCount(Events.ClientReady)).toBe(0);
});
