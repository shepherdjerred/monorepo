import { render } from "ink";
import { ProviderPicker } from "#commands/brim/picker.tsx";
import type { RankedEntry, RankResult } from "#lib/brim/rank.ts";

/**
 * Show the interactive provider picker and resolve with the chosen entry,
 * or null when the selection is cancelled (Esc) or aborted (Ctrl-C).
 * The Ink app is fully unmounted before this resolves, so the caller can
 * safely spawn a subprocess with inherited stdio afterwards.
 */
export async function runPicker(
  result: RankResult,
  programs: ReadonlyMap<string, string>,
  noFish: boolean,
): Promise<RankedEntry | null> {
  let chosen: RankedEntry | null | undefined;
  const app = render(
    <ProviderPicker
      result={result}
      programs={programs}
      noFish={noFish}
      onSubmit={(entry) => {
        chosen = entry;
      }}
    />,
  );
  await app.waitUntilExit();
  // Ink leaves stdin flowing in compiled binaries, which keeps the event
  // loop alive after unmount. Pausing releases it; the underlying TTY fd
  // stays open, so a later fish spawn with inherited stdio is unaffected.
  process.stdin.pause();
  return chosen ?? null;
}
