import type { z } from "zod";
import type {
  PagerDutyIncidentSchema,
  PagerDutyUserSchema,
  PagerDutyServiceSchema,
  PagerDutyTeamSchema,
  PagerDutyAssignmentSchema,
  PagerDutyAcknowledgementSchema,
  PagerDutyPrioritySchema,
  PagerDutyNoteSchema,
  PagerDutyLogEntrySchema,
  PagerDutyIncidentsResponseSchema,
  PagerDutyIncidentResponseSchema,
  PagerDutyNotesResponseSchema,
  PagerDutyLogEntriesResponseSchema,
} from "./schemas.ts";

export type PagerDutyIncidentStatus = "triggered" | "acknowledged" | "resolved";
export type PagerDutyIncidentUrgency = "high" | "low";
export type PagerDutyUser = z.infer<typeof PagerDutyUserSchema>;
export type PagerDutyService = z.infer<typeof PagerDutyServiceSchema>;
export type PagerDutyTeam = z.infer<typeof PagerDutyTeamSchema>;
export type PagerDutyAssignment = z.infer<typeof PagerDutyAssignmentSchema>;
export type PagerDutyPriority = z.infer<typeof PagerDutyPrioritySchema>;
export type PagerDutyAcknowledgement = z.infer<
  typeof PagerDutyAcknowledgementSchema
>;
export type PagerDutyIncident = z.infer<typeof PagerDutyIncidentSchema>;
export type PagerDutyNote = z.infer<typeof PagerDutyNoteSchema>;
export type PagerDutyLogEntry = z.infer<typeof PagerDutyLogEntrySchema>;
export type PagerDutyIncidentsResponse = z.infer<
  typeof PagerDutyIncidentsResponseSchema
>;
export type PagerDutyIncidentResponse = z.infer<
  typeof PagerDutyIncidentResponseSchema
>;
export type PagerDutyNotesResponse = z.infer<
  typeof PagerDutyNotesResponseSchema
>;
export type PagerDutyLogEntriesResponse = z.infer<
  typeof PagerDutyLogEntriesResponseSchema
>;
