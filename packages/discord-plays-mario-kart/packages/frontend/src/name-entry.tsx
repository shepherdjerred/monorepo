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
        className="px-3 py-1.5 rounded bg-slate-800 border border-slate-600 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 w-44"
      />
      <button
        onClick={save}
        disabled={!valid}
        className={`px-3 py-1.5 rounded font-semibold ${
          valid
            ? "bg-emerald-600 hover:bg-emerald-500"
            : "bg-slate-700 opacity-50 cursor-not-allowed"
        }`}
      >
        Set name
      </button>
    </div>
  );
}
