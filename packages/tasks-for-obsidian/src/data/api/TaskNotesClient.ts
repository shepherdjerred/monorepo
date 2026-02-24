import type { ZodType } from "zod";

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
import { type Result, err, ok } from "../../domain/result";
import {
  calendarEventsSchema,
  createTaskResponseSchema,
  deleteResponseSchema,
  filterOptionsSchema,
  healthStatusSchema,
  nlpParseResultSchema,
  pomodoroStatusSchema,
  queryResponseSchema,
  taskListSchema,
  taskResponseSchema,
  taskSchema,
  taskStatsSchema,
  timeSummarySchema,
} from "../../domain/schemas";
import { PATHS } from "./endpoints";

export type TaskNotesClientConfig = {
  baseUrl: string;
  fetch?: typeof fetch;
};

export class TaskNotesClient {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;

  constructor(config: TaskNotesClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async listTasks(): Promise<Result<Task[], AppError>> {
    const result = await this.request("GET", PATHS.TASKS, taskListSchema);
    if (!result.ok) return result;
    return ok(result.value.tasks as unknown as Task[]);
  }

  async getTask(id: TaskId): Promise<Result<Task, AppError>> {
    const result = await this.request("GET", PATHS.TASK(id), taskResponseSchema);
    if (!result.ok) return result;
    return ok(result.value as unknown as Task);
  }

  async createTask(request: CreateTaskRequest): Promise<Result<Task, AppError>> {
    const result = await this.request("POST", PATHS.TASKS, createTaskResponseSchema, request);
    if (!result.ok) return result;
    return ok(result.value as unknown as Task);
  }

  async updateTask(id: TaskId, request: UpdateTaskRequest): Promise<Result<Task, AppError>> {
    const result = await this.request("PUT", PATHS.TASK(id), taskResponseSchema, request);
    if (!result.ok) return result;
    return ok(result.value as unknown as Task);
  }

  async deleteTask(id: TaskId): Promise<Result<void, AppError>> {
    const result = await this.request("DELETE", PATHS.TASK(id), deleteResponseSchema);
    if (!result.ok) return result;
    return ok(undefined);
  }

  async toggleTaskStatus(id: TaskId, newStatus: TaskStatus): Promise<Result<Task, AppError>> {
    return this.updateTask(id, { status: newStatus });
  }

  async archiveTask(id: TaskId): Promise<Result<void, AppError>> {
    const result = await this.request("POST", PATHS.TASK_ARCHIVE(id), deleteResponseSchema);
    if (!result.ok) return result;
    return ok(undefined);
  }

  async completeRecurringInstance(id: TaskId): Promise<Result<Task, AppError>> {
    const result = await this.request("POST", PATHS.TASK_RECURRING(id), taskResponseSchema);
    if (!result.ok) return result;
    return ok(result.value as unknown as Task);
  }

  async queryTasks(filter: TaskQueryFilter): Promise<Result<{ tasks: Task[]; total: number }, AppError>> {
    const result = await this.request("POST", PATHS.TASKS_QUERY, queryResponseSchema, filter);
    if (!result.ok) return result;
    return ok(result.value as unknown as { tasks: Task[]; total: number });
  }

  async getFilterOptions(): Promise<Result<FilterOptions, AppError>> {
    const result = await this.request("GET", PATHS.FILTER_OPTIONS, filterOptionsSchema);
    if (!result.ok) return result;
    return ok(result.value as unknown as FilterOptions);
  }

  async getStats(): Promise<Result<TaskStats, AppError>> {
    const result = await this.request("GET", PATHS.STATS, taskStatsSchema);
    if (!result.ok) return result;
    return ok(result.value as unknown as TaskStats);
  }

  async parseNaturalLanguage(text: string): Promise<Result<NlpParseResult, AppError>> {
    return this.request("POST", PATHS.NLP_PARSE, nlpParseResultSchema, { text });
  }

  async createFromNaturalLanguage(text: string): Promise<Result<Task, AppError>> {
    const result = await this.request("POST", PATHS.NLP_CREATE, taskSchema, { text });
    if (!result.ok) return result;
    return ok(result.value as unknown as Task);
  }

  async startTimeTracking(id: TaskId): Promise<Result<void, AppError>> {
    const result = await this.request("POST", PATHS.TIME_START(id), deleteResponseSchema);
    if (!result.ok) return result;
    return ok(undefined);
  }

  async stopTimeTracking(id: TaskId): Promise<Result<void, AppError>> {
    const result = await this.request("POST", PATHS.TIME_STOP(id), deleteResponseSchema);
    if (!result.ok) return result;
    return ok(undefined);
  }

  async getTaskTime(id: TaskId): Promise<Result<TimeSummary, AppError>> {
    const result = await this.request("GET", PATHS.TASK_TIME(id), timeSummarySchema);
    if (!result.ok) return result;
    return ok(result.value as unknown as TimeSummary);
  }

  async getTimeSummary(): Promise<Result<TimeSummary, AppError>> {
    const result = await this.request("GET", PATHS.TIME_SUMMARY, timeSummarySchema);
    if (!result.ok) return result;
    return ok(result.value as unknown as TimeSummary);
  }

  async startPomodoro(pomodoroTaskId?: TaskId): Promise<Result<PomodoroStatus, AppError>> {
    const result = await this.request("POST", PATHS.POMODORO_START, pomodoroStatusSchema, pomodoroTaskId ? { taskId: pomodoroTaskId } : undefined);
    if (!result.ok) return result;
    return ok(result.value as unknown as PomodoroStatus);
  }

  async stopPomodoro(): Promise<Result<PomodoroStatus, AppError>> {
    const result = await this.request("POST", PATHS.POMODORO_STOP, pomodoroStatusSchema);
    if (!result.ok) return result;
    return ok(result.value as unknown as PomodoroStatus);
  }

  async pausePomodoro(): Promise<Result<PomodoroStatus, AppError>> {
    const result = await this.request("POST", PATHS.POMODORO_PAUSE, pomodoroStatusSchema);
    if (!result.ok) return result;
    return ok(result.value as unknown as PomodoroStatus);
  }

  async getPomodoroStatus(): Promise<Result<PomodoroStatus, AppError>> {
    const result = await this.request("GET", PATHS.POMODORO_STATUS, pomodoroStatusSchema);
    if (!result.ok) return result;
    return ok(result.value as unknown as PomodoroStatus);
  }

  async getCalendarEvents(start?: string, end?: string): Promise<Result<CalendarEvent[], AppError>> {
    const parts: string[] = [];
    if (start) parts.push(`start=${encodeURIComponent(start)}`);
    if (end) parts.push(`end=${encodeURIComponent(end)}`);
    const query = parts.join("&");
    const path = query ? `${PATHS.CALENDAR}?${query}` : PATHS.CALENDAR;
    const result = await this.request("GET", path, calendarEventsSchema);
    if (!result.ok) return result;
    return ok(result.value.events as unknown as CalendarEvent[]);
  }

  async health(): Promise<Result<HealthStatus, AppError>> {
    return this.request("GET", PATHS.HEALTH, healthStatusSchema);
  }

  private async request<T>(
    method: string,
    path: string,
    schema: ZodType<T>,
    body?: unknown,
  ): Promise<Result<T, AppError>> {
    const url = `${this.baseUrl}${path}`;

    let response: Response;
    try {
      response = await this.fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      return err(new ConnectionError(
        `Failed to connect to ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      ));
    }

    if (!response.ok) {
      if (response.status === 404) {
        return err(new NotFoundError("resource", path));
      }
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text().catch(() => undefined);
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
    if (
      typeof json === "object" &&
      json !== null &&
      "success" in json &&
      "data" in json
    ) {
      const envelope = json as { success: boolean; data: unknown; error?: string };
      if (!envelope.success) {
        return err(new ApiError(envelope.error ?? "API returned success=false", 0));
      }
      json = envelope.data;
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
