import * as Sentry from "@sentry/react";
import { z } from "zod";
import type { Kind } from "#src/model/content";
import { safeStorage, type StringStore } from "#src/lib/safe-storage";
import type { StoredBookmark, StoredWatchStatus } from "./schemas.ts";
import {
  BOOKMARKS_KEY,
  LEGACY_KEYS,
  WATCH_STATUS_KEY,
  legacyBackupKey,
} from "./keys.ts";

const LegacyBookmarkSchema = z.looseObject({
  item: z.looseObject({ uuid: z.string().min(1) }),
  date: z.string(),
});

const LegacyWatchStatusSchema = z.looseObject({
  item: z.looseObject({ uuid: z.string().min(1) }),
  isWatched: z.boolean(),
  lastUpdate: z.string(),
});

// Legacy entries stored whole serialized items without a kind discriminant;
// classify by shape one final time. v2 entries store `kind` explicitly.
function legacyItemKind(item: Record<string, unknown>): Kind {
  if ("matchLink" in item) {
    return "commentary";
  }
  if ("videos" in item) {
    return "course";
  }
  return "video";
}

function toIsoDate(input: string): string {
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}

/**
 * One-time, idempotent localStorage migration, run before first render.
 *
 * - The legacy manifest cache is deleted outright (superseded by the
 *   TanStack Query persister).
 * - Legacy bookmark/watch-status entries are salvaged element-wise into the
 *   uuid-based v2 shape; the legacy key is deleted only after the v2 write
 *   succeeds.
 * - Outright-corrupt legacy data is copied to a backup key (never silently
 *   wiped), the v2 store starts empty, and the failure is reported.
 *
 * Runs against `safeStorage`, so a browser that blocks or has exhausted
 * localStorage cannot make this pre-render call throw and blank the app.
 */
export function migrateStorage(storage: StringStore = safeStorage): void {
  storage.removeItem(LEGACY_KEYS.content);
  storage.removeItem(LEGACY_KEYS.contentTimestamp);

  migrateStore({
    storage,
    legacyKey: LEGACY_KEYS.bookmarks,
    v2Key: BOOKMARKS_KEY,
    backupKey: legacyBackupKey("bookmarks"),
    migrateElement: (element) => {
      const legacy = LegacyBookmarkSchema.safeParse(element);
      if (!legacy.success) {
        return;
      }
      return {
        uuid: legacy.data.item.uuid,
        kind: legacyItemKind(legacy.data.item),
        bookmarkedAt: toIsoDate(legacy.data.date),
      };
    },
  });

  migrateStore({
    storage,
    legacyKey: LEGACY_KEYS.watchStatus,
    v2Key: WATCH_STATUS_KEY,
    backupKey: legacyBackupKey("watch-status"),
    migrateElement: (element) => {
      const legacy = LegacyWatchStatusSchema.safeParse(element);
      if (!legacy.success) {
        return;
      }
      return {
        uuid: legacy.data.item.uuid,
        kind: legacyItemKind(legacy.data.item),
        watched: legacy.data.isWatched,
        updatedAt: toIsoDate(legacy.data.lastUpdate),
      };
    },
  });
}

function migrateStore(options: {
  storage: StringStore;
  legacyKey: string;
  v2Key: string;
  backupKey: string;
  migrateElement: (
    element: unknown,
  ) => StoredBookmark | StoredWatchStatus | undefined;
}): void {
  const { storage, legacyKey, v2Key, backupKey, migrateElement } = options;

  if (storage.getItem(v2Key) !== null) {
    return;
  }
  const legacyRaw = storage.getItem(legacyKey);
  if (legacyRaw === null) {
    return;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(legacyRaw);
  } catch {
    decoded = undefined;
  }

  if (!Array.isArray(decoded)) {
    storage.setItem(backupKey, legacyRaw);
    storage.setItem(v2Key, "[]");
    storage.removeItem(legacyKey);
    Sentry.captureMessage(
      `Legacy ${legacyKey} storage was corrupt; preserved at ${backupKey}`,
      "warning",
    );
    return;
  }

  const migrated: (StoredBookmark | StoredWatchStatus)[] = [];
  let dropped = 0;
  for (const element of decoded) {
    const result = migrateElement(element);
    if (result === undefined) {
      dropped += 1;
    } else {
      migrated.push(result);
    }
  }

  storage.setItem(v2Key, JSON.stringify(migrated));
  storage.removeItem(legacyKey);
  if (dropped > 0) {
    Sentry.captureMessage(
      `Dropped ${String(dropped)} unsalvageable legacy ${legacyKey} entries during migration`,
      "warning",
    );
  }
}
