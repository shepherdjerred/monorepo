/** The upstream TaskNotes plugin API paths (v2 contract). */
export const PATHS = {
  TASKS: "/api/tasks",
  TASK: (id: string) => `/api/tasks/${encodeURIComponent(id)}`,
  TASK_ARCHIVE: (id: string) => `/api/tasks/${encodeURIComponent(id)}/archive`,
  TASK_COMPLETE_INSTANCE: (id: string) =>
    `/api/tasks/${encodeURIComponent(id)}/complete-instance`,
  TASKS_QUERY: "/api/tasks/query",
  FILTER_OPTIONS: "/api/filter-options",
  STATS: "/api/stats",
  NLP_PARSE: "/api/nlp/parse",
  NLP_CREATE: "/api/nlp/create",
  TIME_START: (id: string) => `/api/tasks/${encodeURIComponent(id)}/time/start`,
  TIME_STOP: (id: string) => `/api/tasks/${encodeURIComponent(id)}/time/stop`,
  TASK_TIME: (id: string) => `/api/tasks/${encodeURIComponent(id)}/time`,
  TIME_SUMMARY: "/api/time/summary",
  POMODORO_START: "/api/pomodoro/start",
  POMODORO_STOP: "/api/pomodoro/stop",
  POMODORO_PAUSE: "/api/pomodoro/pause",
  POMODORO_STATUS: "/api/pomodoro/status",
  CALENDARS: "/api/calendars/events",
  HEALTH: "/api/health",
} as const;
