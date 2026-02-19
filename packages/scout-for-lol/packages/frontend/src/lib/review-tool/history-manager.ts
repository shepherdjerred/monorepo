/**
 * Manages generation history in IndexedDB (supports large images)
 */
import { z } from "zod";
import type { GenerationResult } from "./config/schema.ts";
import { GenerationMetadataSchema } from "./config/schema.ts";
import * as db from "./indexeddb.ts";

// Zod schemas for validation
// Note: We use `.optional()` which produces `T | undefined`, matching the exact optional properties
const GenerationResultSchema = z.object({
  text: z.string(),
  image: z.string().optional(),
  metadata: z.unknown(),
  error: z.string().optional(),
});

const ConfigSnapshotSchema = z.object({
  model: z.string().optional(),
  personality: z.string().optional(),
  imageDescription: z.string().optional(),
});

export type HistoryEntry = {
  id: string;
  timestamp: Date;
  result: GenerationResult;
  configSnapshot: {
    model?: string;
    personality?: string;
    imageDescription?: string;
  };
  status: "pending" | "complete" | "error";
  rating?: 1 | 2 | 3 | 4;
  notes?: string;
};

const STORAGE_KEY = "scout-review-history"; // For localStorage migration
const MAX_HISTORY_ENTRIES = 50;

/**
 * Build config snapshot from validated config data
 */
function buildConfigSnapshot(
  configData: z.infer<typeof ConfigSnapshotSchema>,
): HistoryEntry["configSnapshot"] {
  return {
    ...(configData.model === undefined ? {} : { model: configData.model }),
    ...(configData.personality === undefined
      ? {}
      : { personality: configData.personality }),
    ...(configData.imageDescription === undefined
      ? {}
      : { imageDescription: configData.imageDescription }),
  };
}

/**
 * Build generation result from validated result data
 */
function buildGenerationResult(
  resultData: z.infer<typeof GenerationResultSchema>,
): GenerationResult {
  const metadataValidation = GenerationMetadataSchema.safeParse(
    resultData.metadata,
  );
  const metadata = metadataValidation.success
    ? metadataValidation.data
    : {
        textDurationMs: 0,
        imageGenerated: false,
      };
  return {
    text: resultData.text,
    ...(resultData.image !== undefined && { image: resultData.image }),
    metadata,
    ...(resultData.error !== undefined && { error: resultData.error }),
  };
}

/**
 * Validate and transform an entry into a HistoryEntry
 */
function validateAndTransformEntry(
  entry: {
    id: string;
    timestamp: string | Date;
    result?: unknown;
    configSnapshot?: unknown;
    status: "pending" | "complete" | "error";
    rating?: 1 | 2 | 3 | 4 | undefined;
    notes?: string | undefined;
  },
  context: "migration" | "load",
): HistoryEntry | null {
  if (entry.result === undefined || entry.configSnapshot === undefined) {
    const prefix =
      context === "migration"
        ? "[History] Skipping invalid entry during migration:"
        : "[History] Skipping invalid entry:";
    console.warn(prefix, entry.id);
    return null;
  }

  const resultValidation = GenerationResultSchema.safeParse(entry.result);
  const configValidation = ConfigSnapshotSchema.safeParse(entry.configSnapshot);

  if (!resultValidation.success || !configValidation.success) {
    const prefix =
      context === "migration"
        ? "[History] Skipping invalid entry during migration:"
        : "[History] Skipping invalid entry:";
    console.warn(prefix, entry.id);
    return null;
  }

  const configSnapshot = buildConfigSnapshot(configValidation.data);
  const result = buildGenerationResult(resultValidation.data);

  return {
    id: entry.id,
    timestamp: new Date(entry.timestamp),
    result,
    configSnapshot,
    status: entry.status,
    ...(entry.rating !== undefined && { rating: entry.rating }),
    ...(entry.notes !== undefined && { notes: entry.notes }),
  };
}

/**
 * Migrate old localStorage data to IndexedDB (one-time migration)
 */
async function migrateFromLocalStorage(): Promise<void> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      return;
    } // Nothing to migrate

    const parsed: unknown = JSON.parse(stored);

    // Validate array structure with Zod
    const MigrationEntrySchema = z.object({
      id: z.string(),
      timestamp: z.union([z.string(), z.date()]),
      result: z.unknown(),
      configSnapshot: z.unknown(),
      status: z.enum(["pending", "complete", "error"]),
      rating: z
        .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
        .optional(),
      notes: z.string().optional(),
    });

    const arrayResult = z.array(MigrationEntrySchema).safeParse(parsed);
    if (!arrayResult.success || arrayResult.data.length === 0) {
      return;
    }

    console.log(
      "[History] Migrating",
      arrayResult.data.length.toString(),
      "entries from localStorage to IndexedDB",
    );

    // Save each entry to IndexedDB
    for (const entry of arrayResult.data) {
      const historyEntry = validateAndTransformEntry(entry, "migration");
      if (historyEntry) {
        await db.saveEntry(historyEntry);
      }
    }

    // Clear localStorage after successful migration
    localStorage.removeItem(STORAGE_KEY);
    console.log("[History] Migration complete");
  } catch (error) {
    console.error("Failed to migrate from localStorage:", error);
  }
}

/**
 * Load all history entries from IndexedDB
 * Only completed and error entries are stored - pending entries are never persisted
 */
export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    // Check if migration is needed (only on first load)
    const count = await db.getEntryCount();
    if (count === 0) {
      await migrateFromLocalStorage();
    }

    const entries = await db.getAllEntries();
    // Convert to HistoryEntry type (IndexedDB stores Date objects correctly)
    const validEntries: HistoryEntry[] = [];
    for (const entry of entries) {
      const historyEntry = validateAndTransformEntry(entry, "load");
      if (historyEntry) {
        validEntries.push(historyEntry);
      }
    }
    return validEntries;
  } catch (error) {
    console.error("Failed to load history from IndexedDB:", error);
    return [];
  }
}

/**
 * Create a new pending history entry (called when generation starts)
 * Returns the entry ID for later updating - NOT saved to localStorage yet
 */
export function createPendingEntry(): string {
  try {
    const id = `gen-${Date.now().toString()}-${Math.random().toString(36).slice(2, 9)}`;
    console.log(
      "[History] Created pending entry ID:",
      id,
      "(not persisted yet)",
    );
    return id;
  } catch {
    return "";
  }
}

/**
 * Save a completed generation to history
 * This is the ONLY way entries get persisted to IndexedDB
 * IndexedDB can handle large images (MB+), unlike localStorage
 */
export async function saveCompletedEntry(
  id: string,
  result: GenerationResult,
  configSnapshot: HistoryEntry["configSnapshot"],
): Promise<void> {
  console.log("[History] Saving completed entry:", id);

  const entry: HistoryEntry = {
    id,
    timestamp: new Date(),
    result, // Keep images! IndexedDB can handle them
    configSnapshot,
    status: result.error !== undefined && result.error.length > 0 ? "error" : "complete",
  };

  try {
    console.log("[History] Saving to IndexedDB (with images)");
    await db.saveEntry(entry);
    console.log("[History] Successfully saved entry");

    // Trim old entries if we exceed max
    await db.trimToMaxEntries(MAX_HISTORY_ENTRIES);

    // Trigger history panel to reload
    globalThis.dispatchEvent(new Event("history-update"));
  } catch (error) {
    console.error("Failed to save to history:", error);
  }
}

/**
 * Delete a specific history entry
 */
export async function deleteHistoryEntry(id: string): Promise<void> {
  try {
    await db.deleteEntry(id);
    // Trigger history panel to reload
    globalThis.dispatchEvent(new Event("history-update"));
  } catch (error) {
    console.error("Failed to delete history entry:", error);
  }
}

/**
 * Clear all history
 */
export async function clearHistory(): Promise<void> {
  try {
    await db.clearAllEntries();
    // Also clear old localStorage data if it exists
    localStorage.removeItem(STORAGE_KEY);
    // Trigger history panel to reload
    globalThis.dispatchEvent(new Event("history-update"));
  } catch (error) {
    console.error("Failed to clear history:", error);
  }
}

/**
 * Update rating for a history entry
 */
export async function updateHistoryRating(
  id: string,
  rating: 1 | 2 | 3 | 4,
  notes?: string,
): Promise<void> {
  try {
    const entry = await db.getEntry(id);
    if (!entry) {
      console.warn(`History entry ${id} not found`);
      return;
    }

    entry.rating = rating;
    if (notes !== undefined) {
      entry.notes = notes;
    }

    await db.saveEntry(entry);
    // Trigger history panel to reload
    globalThis.dispatchEvent(new Event("history-update"));
  } catch (error) {
    console.error("Failed to update rating:", error);
  }
}
