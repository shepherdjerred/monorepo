#!/usr/bin/env bun

import { runWatchCli } from "./watch-cli.ts";

const controlSocket = Bun.env["PR_FLEET_CONTROLLER_CONTROL_SOCKET"];
if (controlSocket === undefined || controlSocket.length === 0) {
  throw new Error("Controller-spawned dashboard is missing its control socket");
}

await runWatchCli(Bun.argv.slice(2), controlSocket);
