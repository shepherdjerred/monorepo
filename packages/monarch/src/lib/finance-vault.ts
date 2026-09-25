import { homedir } from "node:os";
import path from "node:path";
import { Glob } from "bun";

// The finance vault is the durable home for personal finance source data
// (statements, receipts, exports). The repo keeps no copies; parsers read
// straight from these folders. It lives in a Syncthing-synced folder rather
// than a cloud drive so it stays available offline and outside Obsidian.
export const FINANCE_VAULT_DIR = path.join(
  homedir(),
  "Sync",
  "Sync",
  "Finances",
);

export const CONSERVICE_STATEMENTS_DIR = path.join(
  FINANCE_VAULT_DIR,
  "The Victor",
);
export const USAA_STATEMENTS_DIR = path.join(FINANCE_VAULT_DIR, "USAA");
export const COSTCO_DIR = path.join(FINANCE_VAULT_DIR, "Costco");
export const COSTCO_ORDERS_PATH = path.join(COSTCO_DIR, "costco-orders.json");
export const PAYROLL_DIR = path.join(FINANCE_VAULT_DIR, "Payroll");
export const PAYSLIPS_PATH = path.join(PAYROLL_DIR, "payslips.json");
export const EQUITY_DIR = path.join(FINANCE_VAULT_DIR, "Equity");
export const BROKERAGE_DIR = path.join(FINANCE_VAULT_DIR, "Schwab");
export const AUDI_DIR = path.join(FINANCE_VAULT_DIR, "Audi");
export const EDFINANCIAL_DIR = path.join(FINANCE_VAULT_DIR, "Edfinancial");
const VENMO_DIR = path.join(FINANCE_VAULT_DIR, "Venmo");
const SCL_DIR = path.join(FINANCE_VAULT_DIR, "The Victor");

// Derived data splits by cost to recreate. Anything expensive enough that
// losing it hurts — hours of headed scraping, dollars of model judgments —
// lives in the vault so it is backed up with everything else. Cheap,
// regenerable scratch (transaction cache, email index, merchant KB, tier-2
// checkpoints) stays in ~/.monarch-cache.
export const AMAZON_ORDERS_PATH = path.join(
  FINANCE_VAULT_DIR,
  "Amazon",
  "amazon-orders.json",
);
export const EMAIL_MATCH_CHECKPOINT_PATH = path.join(
  FINANCE_VAULT_DIR,
  "cache",
  "email-match-checkpoint.json",
);

// Previous homes, read once when the vault copy is absent so an existing
// cache survives the move.
export const LEGACY_AMAZON_ORDERS_PATH = path.join(
  homedir(),
  ".monarch-amazon-cache.json",
);
export const LEGACY_EMAIL_MATCH_CHECKPOINT_PATH = path.join(
  homedir(),
  ".monarch-cache",
  "email-match-checkpoint.json",
);

// Returns the vault path when it exists, otherwise the legacy path when that
// exists, otherwise the vault path (so a fresh run writes to the vault).
export async function resolveCachePath(
  vaultPath: string,
  legacyPath: string,
): Promise<string> {
  if (await Bun.file(vaultPath).exists()) return vaultPath;
  return (await Bun.file(legacyPath).exists()) ? legacyPath : vaultPath;
}

// Vault exports are named with a leading date or date range, so the
// lexicographically last match is the most recent export.
export function allVaultFiles(dir: string, pattern: string): string[] {
  const glob = new Glob(pattern);
  try {
    return [...glob.scanSync(dir)].sort().map((m) => path.join(dir, m));
  } catch {
    return [];
  }
}

export function latestVaultFile(
  dir: string,
  pattern: string,
): string | undefined {
  const glob = new Glob(pattern);
  let latest: string | undefined;
  try {
    for (const match of glob.scanSync(dir)) {
      if (latest === undefined || match > latest) latest = match;
    }
  } catch {
    return undefined;
  }
  return latest === undefined ? undefined : path.join(dir, latest);
}

// Every Venmo export in the vault. Each covers a fixed date range, so reading
// only the newest silently drops whatever the earlier ones reach further back
// to cover.
export function allVenmoCsvs(): string[] {
  return allVaultFiles(VENMO_DIR, "*Venmo*.csv");
}

export function latestSclCsv(): string | undefined {
  return latestVaultFile(SCL_DIR, "*Seattle_City_Light*.csv");
}

// Schwab names its Equity Award Center export with a YYYYMMDDHHMMSS suffix.
export function latestEquityCsv(): string | undefined {
  return latestVaultFile(EQUITY_DIR, "EquityAwardsCenter_Transactions_*.csv");
}
