import { z } from "zod";

export const PagerDutyUserSchema = z.object({
  id: z.string(),
  type: z.string(),
  summary: z.string(),
  self: z.string(),
  html_url: z.string(),
});

export const PagerDutyServiceSchema = z.object({
  id: z.string(),
  type: z.string(),
  summary: z.string(),
  self: z.string(),
  html_url: z.string(),
});

export const PagerDutyTeamSchema = z.object({
  id: z.string(),
  type: z.string(),
  summary: z.string(),
  self: z.string(),
  html_url: z.string(),
});

export const PagerDutyAssignmentSchema = z.object({
  at: z.string(),
  assignee: PagerDutyUserSchema,
});

export const PagerDutyPrioritySchema = z.object({
  id: z.string(),
  type: z.string(),
  summary: z.string(),
  self: z.string(),
  name: z.string(),
  color: z.string(),
});

export const PagerDutyAcknowledgementSchema = z.object({
  at: z.string(),
  acknowledger: PagerDutyUserSchema,
});

export const PagerDutyIncidentSchema = z.object({
  id: z.string(),
  type: z.string(),
  summary: z.string(),
  self: z.string(),
  html_url: z.string(),
  incident_number: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  status: z.enum(["triggered", "acknowledged", "resolved"]),
  urgency: z.enum(["high", "low"]),
  service: PagerDutyServiceSchema,
  teams: z.array(PagerDutyTeamSchema),
  assignments: z.array(PagerDutyAssignmentSchema),
  acknowledgements: z.array(PagerDutyAcknowledgementSchema),
  last_status_change_at: z.string(),
  last_status_change_by: PagerDutyUserSchema.nullable(),
  escalation_policy: z.object({
    id: z.string(),
    type: z.string(),
    summary: z.string(),
    self: z.string(),
    html_url: z.string(),
  }),
  priority: PagerDutyPrioritySchema.nullable(),
});

export const PagerDutyNoteSchema = z.object({
  id: z.string(),
  user: PagerDutyUserSchema,
  content: z.string(),
  created_at: z.string(),
});

export const PagerDutyLogEntrySchema = z.object({
  id: z.string(),
  type: z.string(),
  summary: z.string(),
  created_at: z.string(),
  agent: z
    .object({
      id: z.string(),
      type: z.string(),
      summary: z.string(),
    })
    .nullable(),
  channel: z.object({
    type: z.string(),
    summary: z.string().optional(),
  }),
});

export const PagerDutyIncidentsResponseSchema = z.object({
  incidents: z.array(PagerDutyIncidentSchema),
  limit: z.number(),
  offset: z.number(),
  total: z.number().nullable(),
  more: z.boolean(),
});

export const PagerDutyIncidentResponseSchema = z.object({
  incident: PagerDutyIncidentSchema,
});

export const PagerDutyNotesResponseSchema = z.object({
  notes: z.array(PagerDutyNoteSchema),
});

export const PagerDutyLogEntriesResponseSchema = z.object({
  log_entries: z.array(PagerDutyLogEntrySchema),
  limit: z.number(),
  offset: z.number(),
  more: z.boolean(),
});
