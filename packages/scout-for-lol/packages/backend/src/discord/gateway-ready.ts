import { Events, type Client } from "discord.js";

/** A completed login call alone does not establish an authoritative voice cache. */
export async function loginReadyGateway(
  client: Client,
  token: string,
): Promise<void> {
  if (client.isReady()) return;
  const ready = Promise.withResolvers<undefined>();
  const onReady = (): void => {
    ready.resolve(undefined);
  };
  client.once(Events.ClientReady, onReady);
  try {
    await client.login(token);
    await ready.promise;
  } finally {
    client.removeListener(Events.ClientReady, onReady);
  }
}
