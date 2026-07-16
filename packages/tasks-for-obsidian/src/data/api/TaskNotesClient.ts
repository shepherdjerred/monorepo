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

export type TaskNotesClientConfig = {
  baseUrl: string;
  authToken?: string | undefined;
  fetch?: typeof fetch;
};

export const MUTATION_ID_HEADER = "X-Mutation-Id";

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

  /** Full pull: the v2 list caps `limit` at 200, so page until done. */
  async listTasks(): Promise<Result<Task[], AppError>> {
    const tasks: Task[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.request(
        "GET",
        `${PATHS.TASKS}?limit=200&offset=${String(offset)}`,
        WireTaskListSchema,
      );
      if (!page.ok) return page;
      tasks.push(...page.value.tasks);
      if (!page.value.pagination.hasMore) return ok(tasks);
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
    instance?: { date: string; completed: boolean },
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
