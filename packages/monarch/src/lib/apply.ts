import type { ProposedChange } from "./classifier/types.ts";
import { applyCategory, flagForReview, applySplits } from "./monarch/client.ts";
import { displaySingleChange } from "./display.ts";
import { log } from "./logger.ts";

export async function promptConfirm(message: string): Promise<boolean> {
  process.stderr.write(`${message} [y/N] `);
  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  const input = value ? new TextDecoder().decode(value).trim().toLowerCase() : "";
  return input === "y" || input === "yes";
}

async function promptInteractive(change: ProposedChange): Promise<"apply" | "skip" | "quit"> {
  displaySingleChange(change);
  process.stderr.write("\n  [a]pply / [s]kip / [q]uit: ");
  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  const input = value ? new TextDecoder().decode(value).trim().toLowerCase() : "s";
  if (input === "a" || input === "apply") return "apply";
  if (input === "q" || input === "quit") return "quit";
  return "skip";
}

async function applySingleChange(change: ProposedChange): Promise<boolean> {
  try {
    if (change.type === "recategorize") {
      if (change.proposedCategoryId === change.currentCategoryId) {
        log.debug(`  Skipping ${change.merchantName} (already ${change.currentCategory})`);
        return true;
      }
      log.info(`  Updating ${change.merchantName} → ${change.proposedCategory}`);
      await applyCategory(change.transactionId, change.proposedCategoryId);
    } else if (change.type === "flag") {
      log.info(`  Flagging ${change.merchantName} for review`);
      await flagForReview(change.transactionId);
    } else if (change.splits !== undefined) {
      log.info(`  Splitting ${change.merchantName}`);
      // Monarch API requires split amounts to match parent transaction sign
      const sign = change.amount < 0 ? -1 : 1;
      await applySplits(
        change.transactionId,
        change.splits.map((s) => ({
          amount: sign * Math.abs(s.amount),
          categoryId: s.categoryId,
          merchantName: s.itemName,
        })),
      );
    }
    return true;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`  Failed to apply change for ${change.merchantName} (${change.transactionId}): ${msg}`);
    return false;
  }
}

export async function applyChanges(
  changes: ProposedChange[],
  interactive: boolean,
): Promise<void> {
  let applied = 0;
  let failed = 0;

  if (interactive) {
    for (const change of changes) {
      const action = await promptInteractive(change);
      if (action === "quit") {
        log.info(`Stopped. Applied ${String(applied)} of ${String(changes.length)} changes.`);
        return;
      }
      if (action === "skip") continue;
      const ok = await applySingleChange(change);
      if (ok) applied++;
      else failed++;
    }
  } else {
    log.info("Applying changes...");
    for (const change of changes) {
      const ok = await applySingleChange(change);
      if (ok) applied++;
      else failed++;
    }
  }

  log.info(`Done! Applied ${String(applied)} changes.${failed > 0 ? ` ${String(failed)} failed.` : ""}`);
}
