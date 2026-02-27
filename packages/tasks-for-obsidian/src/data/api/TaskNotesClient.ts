import { z, type ZodType, type ZodTypeDef } from "zod";

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
  CalendarEventsSchema,
  CreateTaskResponseSchema,
  DeleteResponseSchema,
  FilterOptionsSchema,
  HealthStatusSchema,
  NlpParseResultSchema,
  PomodoroStatusSchema,
  QueryResponseSchema,
  TaskListSchema,
  TaskResponseSchema,
  TaskSchema,
  TaskStatsSchema,
  TimeSummarySchema,
  ApiResponseSchema,
} from "../../domain/schemas";
import { PATHS } from "./endpoints";

export type TaskNotesClientConfig = {
  baseUrl: string;
  authToken?: string | undefined;
  fetch?: typeof fetch;
};

export class TaskNotesClient {
  private readonly baseUrl: string;
  private readonly authToken: string | undefined;
  private readonly fetch: typeof fetch;

  constructor(config: TaskNotesClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.authToken = config.authToken;
    this.fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async listTasks(): Promise<Result<Task[], AppError>> {
    const result = await this.request("GET", `${PATHS.TASKS}?limit=1000`, TaskListSchema);
    if (!result.ok) return result;
    return ok(result.value.tasks);
  }

  async getTask(id: TaskId): Promise<Result<Task, AppError>> {
    return this.request("GET", PATHS.TASK(id), TaskResponseSchema);
  }

  async createTask(request: CreateTaskRequest): Promise<Result<Task, AppError>> {
    return this.request("POST", PATHS.TASKS, CreateTaskResponseSchema, request);
  }

  async updateTask(id: TaskId, request: UpdateTaskRequest): Promise<Result<Task, AppError>> {
    return this.request("PUT", PATHS.TASK(id), TaskResponseSchema, request);
  }

  async deleteTask(id: TaskId): Promise<Result<void, AppError>> {
    const result = await this.request("DELETE", PATHS.TASK(id), DeleteResponseSchema);
    if (!result.ok) return result;
    return OK_VOID;
  }

  async toggleTaskStatus(id: TaskId, newStatus: TaskStatus): Promise<Result<Task, AppError>> {
    return this.updateTask(id, { status: newStatus });
  }

  async archiveTask(id: TaskId): Promise<Result<void, AppError>> {
    const result = await this.request("POST", PATHS.TASK_ARCHIVE(id), DeleteResponseSchema);
    if (!result.ok) return result;
    return OK_VOID;
  }

  async completeRecurringInstance(id: TaskId): Promise<Result<Task, AppError>> {
    return this.request("POST", PATHS.TASK_RECURRING(id), TaskResponseSchema);
  }

  async queryTasks(filter: TaskQueryFilter): Promise<Result<{ tasks: Task[]; total: number }, AppError>> {
    return this.request("POST", PATHS.TASKS_QUERY, QueryResponseSchema, filter);
  }

  async getFilterOptions(): Promise<Result<FilterOptions, AppError>> {
    return this.request("GET", PATHS.FILTER_OPTIONS, FilterOptionsSchema);
  }

  async getStats(): Promise<Result<TaskStats, AppError>> {
    return this.request("GET", PATHS.STATS, TaskStatsSchema);
  }

  async parseNaturalLanguage(text: string): Promise<Result<NlpParseResult, AppError>> {
    return this.request("POST", PATHS.NLP_PARSE, NlpParseResultSchema, { text });
  }

  async createFromNaturalLanguage(text: string): Promise<Result<Task, AppError>> {
    return this.request("POST", PATHS.NLP_CREATE, TaskSchema, { text });
  }

  async startTimeTracking(id: TaskId): Promise<Result<void, AppError>> {
    const result = await this.request("POST", PATHS.TIME_START(id), DeleteResponseSchema);
    if (!result.ok) return result;
    return OK_VOID;
  }

  async stopTimeTracking(id: TaskId): Promise<Result<void, AppError>> {
    const result = await this.request("POST", PATHS.TIME_STOP(id), DeleteResponseSchema);
    if (!result.ok) return result;
    return OK_VOID;
  }

  async getTaskTime(id: TaskId): Promise<Result<TimeSummary, AppError>> {
    return this.request("GET", PATHS.TASK_TIME(id), TimeSummarySchema);
  }

  async getTimeSummary(): Promise<Result<TimeSummary, AppError>> {
    return this.request("GET", PATHS.TIME_SUMMARY, TimeSummarySchema);
  }

  async startPomodoro(pomodoroTaskId?: TaskId): Promise<Result<PomodoroStatus, AppError>> {
    return this.request("POST", PATHS.POMODORO_START, PomodoroStatusSchema, pomodoroTaskId ? { taskId: pomodoroTaskId } : undefined);
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

  async getCalendarEvents(start?: string, end?: string): Promise<Result<CalendarEvent[], AppError>> {
    const parts: string[] = [];
    if (start) parts.push(`start=${encodeURIComponent(start)}`);
    if (end) parts.push(`end=${encodeURIComponent(end)}`);
    const query = parts.join("&");
    const path = query ? `${PATHS.CALENDAR}?${query}` : PATHS.CALENDAR;
    const result = await this.request("GET", path, CalendarEventsSchema);
    if (!result.ok) return result;
    return ok(result.value.events);
  }

  async health(): Promise<Result<HealthStatus, AppError>> {
    return this.request("GET", PATHS.HEALTH, HealthStatusSchema);
  }

  private async request<T>(
    method: string,
    path: string,
    schema: ZodType<T, ZodTypeDef, unknown>,
    body?: unknown,
  ): Promise<Result<T, AppError>> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {};
    if (body) headers["Content-Type"] = "application/json";
    if (this.authToken) headers["Authorization"] = `Bearer ${this.authToken}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(); }, 15_000);

    let response: Response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return err(new ConnectionError(
          `Request to ${this.baseUrl} timed out after 15s`,
        ));
      }
      return err(new ConnectionError(
        `Failed to connect to ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      ));
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
      return err(new ApiError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        responseBody,
      ));
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      return err(new ValidationError(
        `Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)}`,
      ));
    }

    // Unwrap the API envelope: { success, data, error }
    const envelope = ApiResponseSchema(z.unknown()).safeParse(json);
    if (envelope.success) {
      if (!envelope.data.success) {
        return err(new ApiError(envelope.data.error ?? "API returned success=false", 0));
      }
      json = envelope.data.data;
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return err(new ValidationError(
        `Response validation failed: ${parsed.error.message}`,
        parsed.error.issues,
      ));
    }

    return ok(parsed.data);
  }
}
