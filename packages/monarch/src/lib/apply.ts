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

async function applySingleChange(change: ProposedChange): Promise<void> {
  if (change.type === "recategorize") {
    log.info(`  Updating ${change.merchantName} → ${change.proposedCategory}`);
    await applyCategory(change.transactionId, change.proposedCategoryId);
  } else if (change.type === "flag") {
    log.info(`  Flagging ${change.merchantName} for review`);
    await flagForReview(change.transactionId);
  } else if (change.splits !== undefined) {
    log.info(`  Splitting ${change.merchantName}`);
    await applySplits(
      change.transactionId,
      change.splits.map((s) => ({
        amount: s.amount,
        categoryId: s.categoryId,
        merchantName: s.itemName,
      })),
    );
  }
}

export async function applyChanges(
  changes: ProposedChange[],
  interactive: boolean,
): Promise<void> {
  let applied = 0;

  if (interactive) {
    for (const change of changes) {
      const action = await promptInteractive(change);
      if (action === "quit") {
        log.info(`Stopped. Applied ${String(applied)} of ${String(changes.length)} changes.`);
        return;
      }
      if (action === "skip") continue;
      await applySingleChange(change);
      applied++;
    }
  } else {
    log.info("Applying changes...");
    for (const change of changes) {
      await applySingleChange(change);
      applied++;
    }
  }

  log.info(`Done! Applied ${String(applied)} changes.`);
}
