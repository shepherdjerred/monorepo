import path from "node:path";
import { object } from "./codex_theme_restart_terminal.ts";
import type { Appearance } from "./codex_theme_restart_options.ts";

export function themeForAppearance(mode: Appearance): string {
  return mode === "dark" ? "catppuccin-mocha" : "catppuccin-latte";
}

/** The daemon's local control socket uses WebSocket frames, not stdio JSONL. */
export async function syncCodexAppearance(
  mode: Appearance,
  codexHome: string,
): Promise<void> {
  const socketPath = path.join(
    codexHome,
    "app-server-control/app-server-control.sock",
  );
  const socket = new WebSocket(`ws+unix://${socketPath}:/rpc`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error("Codex settings API timed out; no clients stopped"));
      }, 15_000);
      socket.addEventListener("error", () => {
        reject(new Error("Codex settings socket failed; no clients stopped"));
      });
      socket.addEventListener("close", () => {
        reject(
          new Error(
            "Codex settings socket closed before confirmation; no clients stopped",
          ),
        );
      });
      socket.addEventListener("open", () => {
        socket.send(
          JSON.stringify({
            id: 1,
            method: "initialize",
            params: {
              clientInfo: { name: "codex_theme_restart", version: "1" },
              capabilities: { experimentalApi: true },
            },
          }),
        );
      });
      socket.addEventListener("message", (event) => {
        try {
          if (typeof event.data !== "string")
            throw new TypeError("Invalid settings API message");
          const message = object(JSON.parse(event.data));
          if (message.has("error"))
            throw new Error(
              "Codex settings API rejected the request; no clients stopped",
            );
          if (message.get("id") === 1) {
            socket.send(JSON.stringify({ method: "initialized" }));
            socket.send(
              JSON.stringify({
                id: 2,
                method: "config/batchWrite",
                params: {
                  edits: [
                    {
                      keyPath: "tui.theme",
                      value: themeForAppearance(mode),
                      mergeStrategy: "replace",
                    },
                    {
                      keyPath: "tui.resume_cwd",
                      value: "session",
                      mergeStrategy: "replace",
                    },
                  ],
                },
              }),
            );
          }
          if (message.get("id") === 2) {
            if (object(message.get("result")).get("status") !== "ok")
              throw new Error(
                "Codex appearance settings were overridden; no clients stopped",
              );
            resolve();
          }
        } catch {
          reject(
            new Error(
              "Codex settings API did not confirm the update; no clients stopped",
            ),
          );
        }
      });
    });
  } finally {
    clearTimeout(timer);
    socket.close();
  }
}
