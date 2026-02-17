export type BugsinkIssueStatus = "unresolved" | "resolved" | "muted";

export type BugsinkIssueLevel =
  | "fatal"
  | "error"
  | "warning"
  | "info"
  | "debug";

export type BugsinkProject = {
  id: string;
  slug: string;
  name: string;
};

export type BugsinkIssue = {
  id: string;
  short_id: string;
  title: string;
  culprit: string | null;
  level: BugsinkIssueLevel;
  status: BugsinkIssueStatus;
  count: number;
  user_count: number;
  first_seen: string;
  last_seen: string;
  project: BugsinkProject;
  metadata: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
  is_unhandled: boolean;
  platform: string | null;
};

export type BugsinkEventTag = {
  key: string;
  value: string;
};

export type BugsinkStacktraceFrame = {
  filename: string;
  function: string;
  module: string | null;
  lineno: number | null;
  colno: number | null;
  abs_path: string | null;
  context_line: string | null;
  in_app: boolean;
};

export type BugsinkException = {
  type: string;
  value: string;
  module: string | null;
  stacktrace: {
    frames: BugsinkStacktraceFrame[];
  } | null;
};

export type BugsinkEvent = {
  id: string;
  event_id: string;
  title: string;
  message: string | null;
  timestamp: string;
  platform: string | null;
  tags: BugsinkEventTag[];
  exception: {
    values: BugsinkException[];
  } | null;
  user: BugsinkEventUser | null;
};

export type BugsinkEventUser = {
  id: string | null;
  email: string | null;
  username: string | null;
  ip_address: string | null;
};

export type BugsinkPaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};
