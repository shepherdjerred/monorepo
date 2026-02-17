import {
  Connectors,
  NodeOption,
  Shoukaku,
} from "https://esm.sh/shoukaku@4.0.1";
import client from "../discord/client.ts";
import configuration from "../configuration.ts";

export const nodes: NodeOption[] = [
  {
    name: "lavalink",
    url: configuration.lavalinkUrl,
    auth: configuration.lavalinkPassword,
  },
];

export const shoukaku = new Shoukaku(
  new Connectors.DiscordJS(client),
  nodes,
  {},
);
