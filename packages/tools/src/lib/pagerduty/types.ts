export type PagerDutyIncidentStatus = "triggered" | "acknowledged" | "resolved";

export type PagerDutyIncidentUrgency = "high" | "low";

export type PagerDutyUser = {
  id: string;
  type: string;
  summary: string;
  self: string;
  html_url: string;
};

export type PagerDutyService = {
  id: string;
  type: string;
  summary: string;
  self: string;
  html_url: string;
};

export type PagerDutyTeam = {
  id: string;
  type: string;
  summary: string;
  self: string;
  html_url: string;
};

export type PagerDutyAssignment = {
  at: string;
  assignee: PagerDutyUser;
};

export type PagerDutyIncident = {
  id: string;
  type: string;
  summary: string;
  self: string;
  html_url: string;
  incident_number: number;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  status: PagerDutyIncidentStatus;
  urgency: PagerDutyIncidentUrgency;
  service: PagerDutyService;
  teams: PagerDutyTeam[];
  assignments: PagerDutyAssignment[];
  acknowledgements: PagerDutyAcknowledgement[];
  last_status_change_at: string;
  last_status_change_by: PagerDutyUser | null;
  escalation_policy: {
    id: string;
    type: string;
    summary: string;
    self: string;
    html_url: string;
  };
  priority: PagerDutyPriority | null;
};

export type PagerDutyPriority = {
  id: string;
  type: string;
  summary: string;
  self: string;
  name: string;
  color: string;
};

export type PagerDutyAcknowledgement = {
  at: string;
  acknowledger: PagerDutyUser;
};

export type PagerDutyNote = {
  id: string;
  user: PagerDutyUser;
  content: string;
  created_at: string;
};

export type PagerDutyLogEntry = {
  id: string;
  type: string;
  summary: string;
  created_at: string;
  agent: {
    id: string;
    type: string;
    summary: string;
  } | null;
  channel: {
    type: string;
    summary?: string;
  };
};

export type PagerDutyIncidentsResponse = {
  incidents: PagerDutyIncident[];
  limit: number;
  offset: number;
  total: number | null;
  more: boolean;
};

export type PagerDutyIncidentResponse = {
  incident: PagerDutyIncident;
};

export type PagerDutyNotesResponse = {
  notes: PagerDutyNote[];
};

export type PagerDutyLogEntriesResponse = {
  log_entries: PagerDutyLogEntry[];
  limit: number;
  offset: number;
  more: boolean;
};
