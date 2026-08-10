import { z, type ZodType } from "zod";

import type {
  CalendarEvent,
  CreateTaskRequest,
  FilterOptions,
  HealthStatus,
  NlpParseResult,
  PomodoroStatus,
  Task,
  TaskId,
  TaskQueryFilter,
  TaskStats,
  TaskTime,
  TimeSummary,
  UpdateTaskRequest,
} from "../../domain/types";
import type { TaskStatus } from "../../domain/status";
import {
  ApiError,
  ConnectionError,
  NotFoundError,
  ValidationError,
} from "../../domain/errors";
import type { AppError } from "../../domain/errors";
import { type Result, OK_VOID, err, ok } from "../../domain/result";
import {
  ApiResponseSchema,
  HealthStatusSchema,
  NlpParseResultSchema,
  PomodoroStatusSchema,
  TaskStatsSchema,
} from "../../domain/schemas";
import {
  WireCalendarEventsSchema,
  WireDeleteResponseSchema,
  WireFilterOptionsSchema,
  WireNlpCreateSchema,
  WireQueryResponseSchema,
  WireTaskListSchema,
  WireTaskSchema,
  WireTaskTimeSchema,
  WireTimeSummarySchema,
  toWireTaskFields,
  wireNlpParseSchema,
} from "../../domain/wire";
import { PATHS } from "./endpoints";
import type { CompleteInstanceRequest } from "tasknotes-types/v2";

export type TaskNotesClientConfig = {
  baseUrl: string;
  authToken?: string | undefined;
  fetch?: typeof fetch;
};

export const MUTATION_ID_HEADER = "X-Mutation-Id";

/**
 * How many times a full pull re-reads the task list from the beginning when the
 * vault changed underneath the previous read.
 *
 * Bounded rather than open-ended: a vault being edited continuously would
 * otherwise hold one sync pass reading forever, and a pass that gives up is not
 * a pull that is lost — the engine arms its retry on the failure and tries
 * again.
 */
const LIST_PULL_ATTEMPTS = 3;

/**
 * Per-mutation options. `mutationId` is sent as `X-Mutation-Id`, the server's
 * idempotency key: replaying the same mutation (e.g. after a crash between
 * the server ack and the client dequeue) returns the stored response instead
 * of double-applying.
 */
export type MutationOptions = {
  mutationId?: string | undefined;
};

type QueryCondition = {
  type: "condition";
  id: string;
  property: string;
  operator: string;
  value: string | string[] | number | boolean | null;
};

/** The app's flat filter → the upstream FilterQuery tree (AND of conditions). */
function flatFilterToQueryTree(filter: TaskQueryFilter): {
  type: "group";
  id: string;
  conjunction: "and";
  children: QueryCondition[];
} {
  const children: QueryCondition[] = [];
  let n = 0;
  const add = (
    property: string,
    operator: string,
    value: QueryCondition["value"],
  ): void => {
    n += 1;
    children.push({
      type: "condition",
      id: `c${String(n)}`,
      property,
      operator,
      value,
    });
  };
  if (filter.status !== undefined) add("status", "is", [...filter.status]);
  if (filter.priority !== undefined) {
    add("priority", "is", [...filter.priority]);
  }
  if (filter.projects !== undefined) {
    add("projects", "is", [...filter.projects]);
  }
  if (filter.contexts !== undefined) {
    add("contexts", "is", [...filter.contexts]);
  }
  if (filter.tags !== undefined) add("tags", "is", [...filter.tags]);
  if (filter.dueBefore !== undefined) {
    add("due", "is-before", filter.dueBefore);
  }
  if (filter.dueAfter !== undefined) add("due", "is-after", filter.dueAfter);
  if (filter.hasNoDueDate === true) add("due", "is-empty", null);
  if (filter.hasNoProject === true) add("projects", "is-empty", null);
  if (filter.search !== undefined) add("title", "contains", filter.search);
  return { type: "group", id: "app", conjunction: "and", children };
}

export class TaskNotesClient {
  private readonly baseUrl: string;
  private readonly authToken: string | undefined;
  private readonly fetch: typeof fetch;

  constructor(config: TaskNotesClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.authToken = config.authToken;
    this.fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Full pull: the v2 list caps `limit` at 200, so page until done.
   *
   * The endpoint pages by **offset into a live array** — the server slices its
   * repository per request and holds nothing still between them — so a create
   * or a delete landing ahead of the current offset shifts every item after it,
   * and advancing the offset then skips or repeats a task. The sync engine
   * hands whatever comes back to its base-replacement, which treats it as
   * authoritative: a task the vault still holds disappears from the app until
   * some later pull happens to catch it. So each pass validates itself — a
   * stable `total`, no task twice, and exactly `total` tasks at the end — and a
   * pass that fails any of the three is discarded and re-read from the start.
   *
   * One race stays open and cannot be closed from this side: a create and a
   * delete landing between the same two requests leave `total` unchanged and
   * every count consistent while one task quietly takes another's place.
   * Detecting that needs the server to name the revision it answered from,
   * which the v2 contract has no field for.
   *
   * Kept identical to the Rust core's `TaskNotesClient::list_tasks`; the two
   * are an anti-drift pair.
   */
  async listTasks(): Promise<Result<Task[], AppError>> {
    for (let attempt = 0; attempt < LIST_PULL_ATTEMPTS; attempt += 1) {
      const pass = await this.listOnePass();
      if (!pass.ok) return pass;
      if (pass.value !== undefined) return ok(pass.value);
    }
    return err(
      new ApiError(
        `the task list changed underneath ${String(LIST_PULL_ATTEMPTS)} consecutive reads, so no complete list could be taken`,
        0,
      ),
    );
  }

  /**
   * One attempt at reading the whole list. `undefined` means the vault changed
   * between two page requests, so what was collected cannot be trusted.
   */
  private async listOnePass(): Promise<Result<Task[] | undefined, AppError>> {
    const tasks: Task[] = [];
    const seen = new Set<TaskId>();
    let declaredTotal: number | undefined;
    let offset = 0;
    for (;;) {
      const page = await this.request(
        "GET",
        `${PATHS.TASKS}?limit=200&offset=${String(offset)}`,
        WireTaskListSchema,
      );
      if (!page.ok) return page;

      const total = page.value.pagination.total;
      // A total that moved is a create or a delete that landed between two
      // requests, which is exactly what shifts every later offset.
      declaredTotal ??= total;
      if (declaredTotal !== total) return ok(undefined);
      for (const task of page.value.tasks) {
        // The server lists a vault path once, so a repeat is an item that moved
        // across a page boundary rather than a duplicate task — and wherever
        // one repeated, another was skipped.
        if (seen.has(task.id)) return ok(undefined);
        seen.add(task.id);
        tasks.push(task);
      }

      if (!page.value.pagination.hasMore) {
        // Starting at zero and advancing by what arrived visits every index
        // exactly once, so a list shorter than the server's own count means
        // indices moved out from under the walk.
        return ok(tasks.length === total ? tasks : undefined);
      }
      // Advance by what we actually received, not the declared limit, so a
      // short page (items deleted mid-pagination, server edge case) can't
      // skip the gap items on the next request.
      if (page.value.tasks.length === 0) {
        // hasMore with an empty page is a broken server contract; failing
        // fast beats looping forever on a zero-length advance.
        return err(
          new ApiError(
            "Task list pagination returned an empty page while hasMore=true",
            0,
          ),
        );
      }
      offset += page.value.tasks.length;
    }
  }

  async getTask(id: TaskId): Promise<Result<Task, AppError>> {
    return this.request("GET", PATHS.TASK(id), WireTaskSchema);
  }

  async createTask(
    request: CreateTaskRequest,
    options?: MutationOptions,
  ): Promise<Result<Task, AppError>> {
    return this.request("POST", PATHS.TASKS, WireTaskSchema, {
      body: toWireTaskFields(request),
      mutationId: options?.mutationId,
    });
  }

  async updateTask(
    id: TaskId,
    request: UpdateTaskRequest,
    options?: MutationOptions,
  ): Promise<Result<Task, AppError>> {
    return this.request("PUT", PATHS.TASK(id), WireTaskSchema, {
      body: toWireTaskFields(request),
      mutationId: options?.mutationId,
    });
  }

  async deleteTask(
    id: TaskId,
    options?: MutationOptions,
  ): Promise<Result<void, AppError>> {
    const result = await this.request(
      "DELETE",
      PATHS.TASK(id),
      WireDeleteResponseSchema,
      { mutationId: options?.mutationId },
    );
    if (!result.ok) return result;
    return OK_VOID;
  }

  /**
   * Absolute status set. The v2 toggle-status endpoint takes no body and
   * cycles server-side — useless for idempotent offline replay — so the
   * app's absolute-state semantics ride on PUT instead.
   */
  async toggleTaskStatus(
    id: TaskId,
    newStatus: TaskStatus,
    options?: MutationOptions,
  ): Promise<Result<Task, AppError>> {
    return this.request("PUT", PATHS.TASK(id), WireTaskSchema, {
      body: { status: newStatus },
      mutationId: options?.mutationId,
    });
  }

  async archiveTask(id: TaskId): Promise<Result<void, AppError>> {
    // v2 returns the updated task; the app only needs success.
    const result = await this.request(
      "POST",
      PATHS.TASK_ARCHIVE(id),
      WireTaskSchema,
    );
    if (!result.ok) return result;
    return OK_VOID;
  }

  /**
   * With a body, sets the completion state of one instance absolutely
   * (idempotent — safe to replay from the offline queue); without one, the
   * server falls back to its legacy toggle-today behavior.
   */
  async completeRecurringInstance(
    id: TaskId,
    instance?: CompleteInstanceRequest,
    options?: MutationOptions,
  ): Promise<Result<Task, AppError>> {
    return this.request(
      "POST",
      PATHS.TASK_COMPLETE_INSTANCE(id),
      WireTaskSchema,
      {
        body: instance,
        mutationId: options?.mutationId,
      },
    );
  }

  async queryTasks(
    filter: TaskQueryFilter,
  ): Promise<Result<{ tasks: Task[]; total: number }, AppError>> {
    const result = await this.request(
      "POST",
      PATHS.TASKS_QUERY,
      WireQueryResponseSchema,
      { body: flatFilterToQueryTree(filter) },
    );
    if (!result.ok) return result;
    return ok({ tasks: result.value.tasks, total: result.value.filtered });
  }

  async getFilterOptions(): Promise<Result<FilterOptions, AppError>> {
    return this.request("GET", PATHS.FILTER_OPTIONS, WireFilterOptionsSchema);
  }

  async getStats(): Promise<Result<TaskStats, AppError>> {
    return this.request("GET", PATHS.STATS, TaskStatsSchema);
  }

  async parseNaturalLanguage(
    text: string,
  ): Promise<Result<NlpParseResult, AppError>> {
    return this.request(
      "POST",
      PATHS.NLP_PARSE,
      wireNlpParseSchema(NlpParseResultSchema),
      { body: { text } },
    );
  }

  async createFromNaturalLanguage(
    text: string,
  ): Promise<Result<Task, AppError>> {
    return this.request("POST", PATHS.NLP_CREATE, WireNlpCreateSchema, {
      body: { text },
    });
  }

  async startTimeTracking(id: TaskId): Promise<Result<void, AppError>> {
    // v2 returns the updated task; the app only needs success.
    const result = await this.request(
      "POST",
      PATHS.TIME_START(id),
      WireTaskSchema,
    );
    if (!result.ok) return result;
    return OK_VOID;
  }

  async stopTimeTracking(id: TaskId): Promise<Result<void, AppError>> {
    const result = await this.request(
      "POST",
      PATHS.TIME_STOP(id),
      WireTaskSchema,
    );
    if (!result.ok) return result;
    return OK_VOID;
  }

  async getTaskTime(id: TaskId): Promise<Result<TaskTime, AppError>> {
    return this.request("GET", PATHS.TASK_TIME(id), WireTaskTimeSchema);
  }

  async getTimeSummary(period = "all"): Promise<Result<TimeSummary, AppError>> {
    return this.request(
      "GET",
      `${PATHS.TIME_SUMMARY}?period=${encodeURIComponent(period)}`,
      WireTimeSummarySchema,
    );
  }

  async startPomodoro(
    pomodoroTaskId?: TaskId,
  ): Promise<Result<PomodoroStatus, AppError>> {
    return this.request(
      "POST",
      PATHS.POMODORO_START,
      PomodoroStatusSchema,
      pomodoroTaskId ? { body: { taskId: pomodoroTaskId } } : undefined,
    );
  }

  async stopPomodoro(): Promise<Result<PomodoroStatus, AppError>> {
    return this.request("POST", PATHS.POMODORO_STOP, PomodoroStatusSchema);
  }

  async pausePomodoro(): Promise<Result<PomodoroStatus, AppError>> {
    return this.request("POST", PATHS.POMODORO_PAUSE, PomodoroStatusSchema);
  }

  async getPomodoroStatus(): Promise<Result<PomodoroStatus, AppError>> {
    return this.request("GET", PATHS.POMODORO_STATUS, PomodoroStatusSchema);
  }

  async getCalendarEvents(
    start?: string,
    end?: string,
  ): Promise<Result<CalendarEvent[], AppError>> {
    const parts: string[] = [];
    if (start) parts.push(`start=${encodeURIComponent(start)}`);
    if (end) parts.push(`end=${encodeURIComponent(end)}`);
    const query = parts.join("&");
    const path = query ? `${PATHS.CALENDARS}?${query}` : PATHS.CALENDARS;
    const result = await this.request("GET", path, WireCalendarEventsSchema);
    if (!result.ok) return result;
    return ok(result.value.events);
  }

  async health(): Promise<Result<HealthStatus, AppError>> {
    return this.request("GET", PATHS.HEALTH, HealthStatusSchema);
  }

  private async request<T>(
    method: string,
    path: string,
    schema: ZodType<T>,
    init?: { body?: unknown; mutationId?: string | undefined },
  ): Promise<Result<T, AppError>> {
    const url = `${this.baseUrl}${path}`;
    const body = init?.body;

    const headers: Record<string, string> = {};
    if (body) headers["Content-Type"] = "application/json";
    if (this.authToken) headers["Authorization"] = `Bearer ${this.authToken}`;
    if (init?.mutationId !== undefined) {
      headers[MUTATION_ID_HEADER] = init.mutationId;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 15_000);

    let response: Response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return err(
          new ConnectionError(`Request to ${this.baseUrl} timed out after 15s`),
        );
      }
      return err(
        new ConnectionError(
          `Failed to connect to ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      if (response.status === 404) {
        return err(new NotFoundError("resource", path));
      }
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text().catch(() => "");
      }
      return err(
        new ApiError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          responseBody,
        ),
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      return err(
        new ValidationError(
          `Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }

    // Unwrap the API envelope: { success, data, error }
    const envelope = ApiResponseSchema(z.unknown()).safeParse(json);
    if (envelope.success) {
      if (!envelope.data.success) {
        return err(
          new ApiError(envelope.data.error ?? "API returned success=false", 0),
        );
      }
      json = envelope.data.data;
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return err(
        new ValidationError(
          `Response validation failed: ${parsed.error.message}`,
          parsed.error.issues,
        ),
      );
    }

    return ok(parsed.data);
  }
}
