import path from "node:path";

import type {
  CreateTaskRequest,
  FilterOptions,
  Task,
  TaskQueryFilter,
  TaskStats,
  UpdateTaskRequest,
} from "../domain/types.ts";
import { ALL_PRIORITIES, ALL_STATUSES } from "../domain/types.ts";
import { scanVault } from "../vault/reader.ts";
import {
  deleteTaskFile,
  generateId,
  taskFilePath,
  writeTaskFile,
} from "../vault/writer.ts";
import { watchVault } from "../vault/watcher.ts";

function toISODate(date: Date): string {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildStatusCounts(): TaskStats["byStatus"] {
  return {
    "open": 0,
    "in-progress": 0,
    "done": 0,
    "cancelled": 0,
    "waiting": 0,
    "delegated": 0,
  };
}

function buildPriorityCounts(): TaskStats["byPriority"] {
  return {
    "highest": 0,
    "high": 0,
    "medium": 0,
    "normal": 0,
    "low": 0,
    "none": 0,
  };
}

export class TaskStore {
  private tasks = new Map<string, Task>();
  private readonly vaultPath: string;
  private readonly tasksDir: string;

  constructor(vaultPath: string, tasksDir: string) {
    this.vaultPath = path.resolve(vaultPath);
    this.tasksDir = tasksDir;
  }

  async init(): Promise<void> {
    this.tasks = await scanVault(this.vaultPath, this.tasksDir);
  }

  startWatching(): void {
    watchVault(this.vaultPath, this.tasksDir, () => {
      void this.init();
    });
  }

  getAll(limit = 1000, offset = 0): { tasks: Task[]; total: number } {
    const all = [...this.tasks.values()].filter((t) => !t.archived);
    return {
      tasks: all.slice(offset, offset + limit),
      total: all.length,
    };
  }

  getById(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  async create(request: CreateTaskRequest): Promise<Task> {
    const id = generateId();
    const task: Task = {
      id,
      path: "",
      title: request.title,
      status: request.status ?? "open",
      priority: request.priority ?? "normal",
      due: request.due,
      scheduled: request.scheduled,
      contexts: request.contexts === undefined ? [] : [...request.contexts],
      projects: request.projects === undefined ? [] : [...request.projects],
      tags: request.tags === undefined ? [] : [...request.tags],
      recurrence: request.recurrence,
      archived: false,
      totalTrackedTime: 0,
      isBlocked: false,
      isBlocking: false,
      description: request.description,
    };

    const absPath = taskFilePath(this.vaultPath, this.tasksDir, task);
    const filename = path.basename(absPath);
    const relativePath = this.tasksDir === ""
      ? filename
      : path.join(this.tasksDir, filename);

    const storedTask: Task = { ...task, path: relativePath };
    await writeTaskFile(absPath, storedTask);
    this.tasks.set(id, storedTask);
    return storedTask;
  }

  async update(id: string, request: UpdateTaskRequest): Promise<Task | undefined> {
    const existing = this.tasks.get(id);
    if (existing === undefined) return undefined;

    const updated: Task = {
      ...existing,
      title: request.title ?? existing.title,
      description: request.description ?? existing.description,
      status: request.status ?? existing.status,
      priority: request.priority ?? existing.priority,
      due: request.due === null ? undefined : (request.due ?? existing.due),
      scheduled: request.scheduled === null ? undefined : (request.scheduled ?? existing.scheduled),
      contexts: request.contexts === undefined ? existing.contexts : [...request.contexts],
      projects: request.projects === undefined ? existing.projects : [...request.projects],
      tags: request.tags === undefined ? existing.tags : [...request.tags],
      recurrence: request.recurrence === null ? undefined : (request.recurrence ?? existing.recurrence),
    };

    const filePath = path.resolve(this.vaultPath, existing.path);
    await writeTaskFile(filePath, updated);
    this.tasks.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const existing = this.tasks.get(id);
    if (existing === undefined) return false;

    const filePath = path.resolve(this.vaultPath, existing.path);
    await deleteTaskFile(filePath);
    this.tasks.delete(id);
    return true;
  }

  async archive(id: string): Promise<boolean> {
    const existing = this.tasks.get(id);
    if (existing === undefined) return false;

    const archived: Task = { ...existing, archived: true };
    const filePath = path.resolve(this.vaultPath, existing.path);
    await writeTaskFile(filePath, archived);
    this.tasks.set(id, archived);
    return true;
  }

  async completeRecurring(id: string): Promise<Task | undefined> {
    const existing = this.tasks.get(id);
    if (existing === undefined) return undefined;

    const completed: Task = { ...existing, status: "done" };
    const filePath = path.resolve(this.vaultPath, existing.path);
    await writeTaskFile(filePath, completed);
    this.tasks.set(id, completed);
    return completed;
  }

  query(filter: TaskQueryFilter): { tasks: Task[]; total: number } {
    let results = [...this.tasks.values()];

    if (filter.status !== undefined && filter.status.length > 0) {
      const statusSet = new Set(filter.status);
      results = results.filter((t) => statusSet.has(t.status));
    }

    if (filter.priority !== undefined && filter.priority.length > 0) {
      const prioritySet = new Set(filter.priority);
      results = results.filter((t) => prioritySet.has(t.priority));
    }

    if (filter.projects !== undefined && filter.projects.length > 0) {
      const projectSet = new Set(filter.projects);
      results = results.filter((t) =>
        t.projects.some((p) => projectSet.has(p)),
      );
    }

    if (filter.contexts !== undefined && filter.contexts.length > 0) {
      const contextSet = new Set(filter.contexts);
      results = results.filter((t) =>
        t.contexts.some((c) => contextSet.has(c)),
      );
    }

    if (filter.tags !== undefined && filter.tags.length > 0) {
      const tagSet = new Set(filter.tags);
      results = results.filter((t) =>
        t.tags.some((tag) => tagSet.has(tag)),
      );
    }

    if (filter.dueBefore !== undefined) {
      const dueBefore = filter.dueBefore;
      results = results.filter((t) => t.due !== undefined && t.due <= dueBefore);
    }

    if (filter.dueAfter !== undefined) {
      const dueAfter = filter.dueAfter;
      results = results.filter((t) => t.due !== undefined && t.due >= dueAfter);
    }

    if (filter.hasNoDueDate === true) {
      results = results.filter((t) => t.due === undefined);
    }

    if (filter.hasNoProject === true) {
      results = results.filter((t) => t.projects.length === 0);
    }

    if (filter.search !== undefined && filter.search !== "") {
      const searchLower = filter.search.toLowerCase();
      results = results.filter(
        (t) =>
          t.title.toLowerCase().includes(searchLower) ||
          (t.description?.toLowerCase().includes(searchLower) ?? false),
      );
    }

    return { tasks: results, total: results.length };
  }

  getStats(): TaskStats {
    const all = [...this.tasks.values()];
    const today = toISODate(new Date());

    const byStatus = buildStatusCounts();
    const byPriority = buildPriorityCounts();

    let overdue = 0;
    let dueToday = 0;
    let upcoming = 0;

    for (const task of all) {
      byStatus[task.status]++;
      byPriority[task.priority]++;

      if (task.due !== undefined) {
        if (task.due < today && task.status !== "done" && task.status !== "cancelled") {
          overdue++;
        } else if (task.due === today) {
          dueToday++;
        } else if (task.due > today) {
          upcoming++;
        }
      }
    }

    return {
      total: all.length,
      byStatus,
      byPriority,
      overdue,
      dueToday,
      upcoming,
    };
  }

  getFilterOptions(): FilterOptions {
    const projects = new Set<string>();
    const contexts = new Set<string>();
    const tags = new Set<string>();

    for (const task of this.tasks.values()) {
      for (const p of task.projects) projects.add(p);
      for (const c of task.contexts) contexts.add(c);
      for (const t of task.tags) tags.add(t);
    }

    return {
      projects: [...projects].toSorted(),
      contexts: [...contexts].toSorted(),
      tags: [...tags].toSorted(),
      statuses: [...ALL_STATUSES],
      priorities: [...ALL_PRIORITIES],
    };
  }
}
