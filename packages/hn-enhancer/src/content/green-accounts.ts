import { collapseThread, getCommentUsername } from "#src/lib/dom.ts";
import { fetchUserAccountAge, isNewAccount } from "#src/lib/hn-api.ts";
import type { Settings } from "#src/types/storage.ts";

let settings: Settings["hideGreenAccounts"];
const accountAgeCache = new Map<string, number | undefined>();
const pendingFetches = new Set<string>();

export function initGreenAccounts(s: Settings): void {
  settings = s.hideGreenAccounts;
  processAllRows();
}

export function updateGreenAccountSettings(s: Settings["hideGreenAccounts"]): void {
  settings = s;
  clearMarkers();
  processAllRows();
}

export function processRows(rows: Iterable<HTMLTableRowElement>): void {
  if (!settings.enabled) return;

  const usernames = new Set<string>();
  const rowsByUser = new Map<string, HTMLTableRowElement[]>();

  for (const row of rows) {
    const username = getCommentUsername(row);
    if (username === undefined || username === "") continue;

    usernames.add(username);
    const existing = rowsByUser.get(username) ?? [];
    existing.push(row);
    rowsByUser.set(username, existing);
  }

  // Check cached users immediately
  for (const [username, userRows] of rowsByUser) {
    const cached = accountAgeCache.get(username);
    if (cached !== undefined && isNewAccount(cached, settings.ageDays)) {
        for (const row of userRows) {
          markAsGreenAccount(row);
        }
      }
  }

  // Fetch uncached users
  const uncached = [...usernames].filter(
    (u) => !accountAgeCache.has(u) && !pendingFetches.has(u),
  );

  if (uncached.length > 0) {
    void fetchAndProcess(uncached, rowsByUser);
  }
}

async function fetchAndProcess(
  usernames: string[],
  rowsByUser: Map<string, HTMLTableRowElement[]>,
): Promise<void> {
  const batchSize = 5;

  for (let i = 0; i < usernames.length; i += batchSize) {
    const batch = usernames.slice(i, i + batchSize);

    for (const username of batch) {
      pendingFetches.add(username);
    }

    const results = await Promise.all(
      batch.map(async (username) => {
        const created = await fetchUserAccountAge(username);
        return { username, created };
      }),
    );

    for (const { username, created } of results) {
      pendingFetches.delete(username);
      accountAgeCache.set(username, created);

      if (created !== undefined && isNewAccount(created, settings.ageDays)) {
        const rows = rowsByUser.get(username) ?? [];
        for (const row of rows) {
          markAsGreenAccount(row);
        }
      }
    }

    // Small delay between batches to be respectful to the API
    if (i + batchSize < usernames.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
    }
  }
}

function processAllRows(): void {
  const rows = document.querySelectorAll<HTMLTableRowElement>("tr.athing.comtr");
  processRows(rows);
}

function markAsGreenAccount(row: HTMLTableRowElement): void {
  row.dataset.hnGreenAccount = "true";
  collapseThread(row);

  // Add indicator
  let indicator = row.querySelector<HTMLSpanElement>(".hn-green-indicator");
  if (!indicator) {
    indicator = document.createElement("span");
    indicator.className = "hn-green-indicator";
    indicator.textContent = " [new account]";
    const comhead = row.querySelector(".comhead");
    if (comhead) {
      comhead.append(indicator);
    }
  }
}

function clearMarkers(): void {
  const rows = document.querySelectorAll<HTMLTableRowElement>("[data-hn-green-account]");
  for (const row of rows) {
    delete row.dataset.hnGreenAccount;
    row.style.display = "";

    const indicator = row.querySelector(".hn-green-indicator");
    if (indicator) indicator.remove();
  }
}
