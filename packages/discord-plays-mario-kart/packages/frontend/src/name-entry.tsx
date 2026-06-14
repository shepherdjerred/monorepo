import { useEffect, useState } from "react";
import {
  PLAYER_NAME_MAX,
  PlayerNameSchema,
  type NameSetRequest,
} from "@discord-plays-mario-kart/common";
import { socket } from "./socket.ts";

const STORAGE_KEY = "dpmk-name";

function loadStoredName(): string {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Send a name-set request, tolerating an empty value as "clear". */
function sendName(name: string | null): void {
  const request: NameSetRequest = { kind: "name-set", name };
  socket.emit("request", request);
}

/**
 * Name entry tied to a claimed seat. The typed name is remembered in
 * localStorage and re-sent automatically whenever a (new) seat is claimed, so a
 * returning player keeps their identity without retyping.
 */
export function NameEntry({ seat }: { seat: number }) {
  const [name, setName] = useState<string>(loadStoredName);
  const trimmed = name.trim();
  const valid = PlayerNameSchema.safeParse(trimmed).success;

  // Auto-send the stored name on each seat claim (seat changes 0..3).
  useEffect(() => {
    const stored = loadStoredName().trim();
    if (stored.length > 0 && PlayerNameSchema.safeParse(stored).success) {
      sendName(stored);
    }
  }, [seat]);

  const save = () => {
    if (!valid) return;
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, trimmed);
    } catch {
      /* private mode / disabled storage — non-fatal */
    }
    sendName(trimmed);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={name}
        maxLength={PLAYER_NAME_MAX}
        placeholder="Your name"
        onChange={(e) => {
          setName(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
        }}
        className="w-44 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-400 focus:outline-none"
      />
      <button
        type="button"
        onClick={save}
        disabled={!valid}
        className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
          valid
            ? "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
            : "cursor-not-allowed bg-zinc-800 text-zinc-500"
        }`}
      >
        Set name
      </button>
    </div>
  );
}
