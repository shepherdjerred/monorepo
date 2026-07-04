import path from "node:path";
import {
  applyFrontmatterPatch,
  buildRecurringTaskCompletePlan,
  buildStartTimeTrackingPlan,
  buildStopTimeTrackingPlan,
  buildTaskUpdatePlan,
  detectTaskFile,
  getActiveTimeEntry,
  getDefaultCompletedStatus,
  isCompletedStatus,
  parseTaskDocument,
  recurringCompletePlanToFrontmatterPatch,
  serializeMarkdownDocument,
  serializeTaskDocument,
} from "tasknotes-types/v2";
import type {
  TaskCreationRequest,
  TaskInfo,
  TaskNotesModelConfig,
  TaskUpdateInput,
  TaskUpdateRequest,
} from "tasknotes-types/v2";

import {
  deleteFile,
  listMarkdownFiles,
  readFileSnapshot,
  writeFileAtomic,
} from "./vault-files.ts";
import { newTaskPath } from "./filename.ts";

/**
 * The vault-backed task store, built entirely on @tasknotes/model — the
 * plugin's own engine. Reads are tolerant (`parseTaskDocument` +
 * `detectTaskFile`); every task-like file that fails to parse is COUNTED
 * and LOGGED, never silently dropped (review finding #2). Writes are
 * read-modify-write from disk through the model's plan builders and
 * `applyFrontmatterPatch`, so an Obsidian edit landing between our read and
 * write only loses the specific frontmatter keys we patched — never the
 * body, never unrelated keys (findings #6/#7).
 *
 * Task IDs are vault-relative paths (upstream semantics).
 */

export type SkippedFile = {
  readonly path: string;
  readonly reason: string;
};

type CacheEntry = {
  readonly task: TaskInfo;
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
  readonly mtimeMs: number;
};

export type Clock = () => Date;

// Write inputs are the WIRE request types (zod v4 parse output). Their
// optionals are `T | undefined`, which exactOptionalPropertyTypes will not
// narrow to the model's `T?` — undefined-valued keys are scrubbed before
// reaching the plan builders (the runtime values are schema-validated).
function scrubUndefined(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export class TaskRepository {
  private cache = new Map<string, CacheEntry>();
  private skipped = new Map<string, string>();

  constructor(
    private readonly vaultPath: string,
    private readonly tasksDir: string,
    private readonly config: TaskNotesModelConfig,
    private readonly clock: Clock = () => new Date(),
  ) {}

  // -- read side ------------------------------------------------------------

  /** Full scan. Throws if the vault root is unreadable (startup gate). */
  async scan(): Promise<void> {
    const files = await listMarkdownFiles(this.vaultPath);
    const nextCache = new Map<string, CacheEntry>();
    const nextSkipped = new Map<string, string>();
    for (const relPath of files) {
      const loaded = await this.loadFile(relPath);
      if (loaded === null) continue;
      if (typeof loaded === "string") {
        nextSkipped.set(relPath, loaded);
        continue;
      }
      nextCache.set(relPath, loaded);
    }
    this.cache = nextCache;
    this.skipped = nextSkipped;
    this.logSkipped();
  }

  /**
   * Re-read one file after a watcher event. Absent → drop from cache;
   * broken → move to skipped (loudly); otherwise refresh the entry.
   */
  async refreshFile(relPath: string): Promise<void> {
    const loaded = await this.loadFile(relPath);
    if (loaded === null) {
      this.cache.delete(relPath);
      this.skipped.delete(relPath);
      return;
    }
    if (typeof loaded === "string") {
      this.cache.delete(relPath);
      this.skipped.set(relPath, loaded);
      console.error(`[task-repository] skipped ${relPath}: ${loaded}`);
      return;
    }
    this.skipped.delete(relPath);
    this.cache.set(relPath, loaded);
  }

  list(): TaskInfo[] {
    return [...this.cache.values()].map((entry) => entry.task);
  }

  get(id: string): CacheEntry | undefined {
    return this.cache.get(id);
  }

  skippedFiles(): SkippedFile[] {
    return [...this.skipped.entries()].map(([p, reason]) => ({
      path: p,
      reason,
    }));
  }

  /**
   * Load one file. Returns:
   * - CacheEntry — parsed task
   * - null      — not a task file (or vanished); nothing to report
   * - string    — task-LIKE file we failed to parse (the skip reason)
   */
  private async loadFile(relPath: string): Promise<CacheEntry | string | null> {
    const snapshot = await readFileSnapshot(this.absPath(relPath));
    if (snapshot === null) return null;
    try {
      const doc = parseTaskDocument(snapshot.text, {
        path: relPath,
        fieldMapping: this.config.fieldMapping,
        storeTitleInFilename: this.config.storeTitleInFilename,
        userFields: this.config.userFields,
        statuses: this.config.statuses,
        priorities: this.config.priorities,
      });
      const isTask = detectTaskFile({
        taskDetection: this.config.taskIdentification,
        frontmatter: doc.frontmatter,
        body: doc.body,
        filePath: relPath,
      });
      if (!isTask) return null;
      return {
        task: this.completeTask(doc.task, relPath),
        frontmatter: doc.frontmatter,
        body: doc.body,
        mtimeMs: snapshot.mtimeMs,
      };
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /** Fill required TaskInfo fields the tolerant parser may leave absent. */
  private completeTask(partial: Partial<TaskInfo>, relPath: string): TaskInfo {
    const filenameTitle = path.basename(relPath, ".md");
    return {
      ...partial,
      title: partial.title ?? filenameTitle,
      status: partial.status ?? this.config.defaults.status,
      priority: partial.priority ?? this.config.defaults.priority,
      path: relPath,
      id: relPath,
      archived: partial.archived ?? false,
    };
  }

  // -- write side -----------------------------------------------------------

  async create(data: TaskCreationRequest): Promise<TaskInfo> {
    const relPath = newTaskPath(
      this.tasksDir,
      data.title,
      new Set(this.cache.keys()),
    );
    const now = this.clock();
    const { details, ...rest } = data;
    const fields = scrubUndefined(rest);
    const task: Partial<TaskInfo> = {
      status: this.config.defaults.status,
      priority: this.config.defaults.priority,
      ...fields,
      dateCreated: now.toISOString(),
      dateModified: now.toISOString(),
    };
    const markdown = serializeTaskDocument(task, details ?? "", {
      fieldMapping: this.config.fieldMapping,
      taskTag: this.config.taskIdentification.tag,
      storeTitleInFilename: this.config.storeTitleInFilename,
      userFields: this.config.userFields,
    });
    await writeFileAtomic(this.absPath(relPath), markdown);
    await this.refreshFile(relPath);
    return this.mustGet(relPath).task;
  }

  async update(id: string, updates: TaskUpdateRequest): Promise<TaskInfo> {
    const fresh = await this.readFresh(id);
    const scrubbed: TaskUpdateInput = scrubUndefined(updates);
    const plan = buildTaskUpdatePlan({
      originalTask: fresh.task,
      updates: scrubbed,
      fieldMapping: this.config.fieldMapping,
      taskTag: this.config.taskIdentification.tag,
      storeTitleInFilename: this.config.storeTitleInFilename,
      userFields: this.config.userFields,
      statuses: this.config.statuses,
      now: this.clock().toISOString(),
      currentDateString: ymd(this.clock()),
    });
    return this.applyPlanPatch(id, fresh, plan.frontmatterPatch, {
      newPath: plan.updatedTask.path,
      // null details = clear the body (upstream null-as-clear convention).
      details: updates.details === null ? "" : updates.details,
    });
  }

  async delete(id: string): Promise<void> {
    if (!this.cache.has(id)) {
      throw new TaskNotFoundError(id);
    }
    await deleteFile(this.absPath(id));
    this.cache.delete(id);
  }

  /** Upstream semantics: no body; cycle the configured status workflow. */
  async toggleStatus(id: string): Promise<TaskInfo> {
    const fresh = await this.readFresh(id);
    const statuses = this.config.statuses;
    const currentIndex = statuses.findIndex(
      (s) => s.value === fresh.task.status,
    );
    const inCycle = statuses.filter((s) => !(s.excludeFromCycle ?? false));
    const current = statuses[currentIndex];
    const explicitNext = current?.nextStatus;
    let nextValue: string;
    if (explicitNext !== undefined && explicitNext.length > 0) {
      nextValue = explicitNext;
    } else {
      const cycleIndex = inCycle.findIndex(
        (s) => s.value === fresh.task.status,
      );
      const next = inCycle[(cycleIndex + 1) % inCycle.length];
      if (next === undefined) {
        throw new Error("status workflow is empty — check plugin settings");
      }
      nextValue = next.value;
    }
    return this.update(id, { status: nextValue });
  }

  async toggleArchive(id: string): Promise<TaskInfo> {
    const fresh = await this.readFresh(id);
    return this.update(id, { archived: !fresh.task.archived });
  }

  /**
   * Recurring instance completion via the model's plan. `completed` gives
   * set-semantics (P1 contract): matching current state is a no-op instead
   * of a toggle, which is what makes offline replay idempotent.
   */
  async completeInstance(
    id: string,
    options: {
      date?: string | undefined;
      completed?: boolean | undefined;
    } = {},
  ): Promise<TaskInfo> {
    const fresh = await this.readFresh(id);
    const recurrence = fresh.task.recurrence;
    if (recurrence === undefined || recurrence.length === 0) {
      // Upstream 400s on non-recurring; route layer translates this.
      throw new NotRecurringError(id);
    }
    const targetDate =
      options.date === undefined ? this.clock() : new Date(options.date);
    const dateStr = ymd(targetDate);
    const already = (fresh.task.complete_instances ?? []).includes(dateStr);
    if (options.completed !== undefined && options.completed === already) {
      return fresh.task; // set-semantics no-op
    }
    const plan = buildRecurringTaskCompletePlan({
      freshTask: fresh.task,
      targetDate,
      currentTimestamp: this.clock().toISOString(),
      maintainDueDateOffsetInRecurring:
        this.config.recurrence.maintainDueDateOffset,
    });
    const patch = recurringCompletePlanToFrontmatterPatch(
      plan,
      this.config.fieldMapping,
    );
    return this.applyPlanPatch(id, fresh, patch, {});
  }

  /**
   * Start a tracking session (upstream: 400 if one is already active).
   * The plan's timeEntries land in frontmatter via a normal update patch.
   */
  async startTime(id: string): Promise<TaskInfo> {
    const fresh = await this.readFresh(id);
    if (getActiveTimeEntry(fresh.task) !== undefined) {
      throw new TimeTrackingError("Time tracking is already active");
    }
    const plan = buildStartTimeTrackingPlan(
      fresh.task,
      this.clock().toISOString(),
    );
    return this.update(id, { timeEntries: plan.updatedTask.timeEntries ?? [] });
  }

  /** Stop the active tracking session (upstream: 400 if none). */
  async stopTime(id: string): Promise<TaskInfo> {
    const fresh = await this.readFresh(id);
    const active = getActiveTimeEntry(fresh.task);
    if (active === undefined) {
      throw new TimeTrackingError("No active time tracking session");
    }
    const plan = buildStopTimeTrackingPlan(
      fresh.task,
      active,
      this.clock().toISOString(),
    );
    return this.update(id, { timeEntries: plan.updatedTask.timeEntries ?? [] });
  }

  /** True when `status` is a completed status under the user's workflow. */
  isCompleted(status: string | undefined): boolean {
    return isCompletedStatus(status, this.config.statuses);
  }

  defaultCompletedStatus(): string {
    return getDefaultCompletedStatus(this.config.statuses);
  }

  // -- internals ------------------------------------------------------------

  private absPath(relPath: string): string {
    return path.join(this.vaultPath, relPath);
  }

  private mustGet(id: string): CacheEntry {
    const entry = this.cache.get(id);
    if (entry === undefined) throw new TaskNotFoundError(id);
    return entry;
  }

  /** Read-modify-write starts from DISK, not the cache (finding #6). */
  private async readFresh(id: string): Promise<CacheEntry> {
    if (!this.cache.has(id) && !this.skipped.has(id)) {
      throw new TaskNotFoundError(id);
    }
    await this.refreshFile(id);
    return this.mustGet(id);
  }

  private async applyPlanPatch(
    id: string,
    fresh: CacheEntry,
    patch: Parameters<typeof applyFrontmatterPatch>[1],
    options: { newPath?: string | undefined; details?: string | undefined },
  ): Promise<TaskInfo> {
    // A null value means CLEAR: drop the key entirely instead of writing a
    // literal "key: null" line into frontmatter.
    const patched = Object.fromEntries(
      Object.entries(applyFrontmatterPatch(fresh.frontmatter, patch)).filter(
        ([, value]) => value !== null,
      ),
    );
    const body = options.details ?? fresh.body;
    const markdown = serializeMarkdownDocument(patched, body);

    const targetPath =
      options.newPath !== undefined && options.newPath !== id
        ? options.newPath
        : id;
    await writeFileAtomic(this.absPath(targetPath), markdown);
    if (targetPath !== id) {
      // Title rename under storeTitleInFilename: new path = new identity.
      await deleteFile(this.absPath(id));
      this.cache.delete(id);
    }
    await this.refreshFile(targetPath);
    return this.mustGet(targetPath).task;
  }

  private logSkipped(): void {
    for (const [p, reason] of this.skipped) {
      console.error(`[task-repository] skipped ${p}: ${reason}`);
    }
  }
}

export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Task not found: ${id}`);
    this.name = "TaskNotFoundError";
  }
}

export class TimeTrackingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeTrackingError";
  }
}

export class NotRecurringError extends Error {
  constructor(id: string) {
    super(`Task is not recurring: ${id}`);
    this.name = "NotRecurringError";
  }
}

function ymd(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${month}-${day}`;
}
