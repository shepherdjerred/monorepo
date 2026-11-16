import * as testPostgres from "@shepherdjerred/test-postgres";

export const SWEEP_GRACE_MS = testPostgres.SWEEP_GRACE_MS;

export type DatabaseOwner = testPostgres.DatabaseOwner;
export type OwnerRecord = testPostgres.OwnerRecord;
export type ProcessProbe = testPostgres.ProcessProbe;
export type OwnerProcessState = testPostgres.OwnerProcessState;
export type SweepDecision = testPostgres.SweepDecision;
export type TemplateRebuildDecision = testPostgres.TemplateRebuildDecision;

export const formatOwnerComment = testPostgres.formatOwnerComment;
export const parseOwnerComment = testPostgres.parseOwnerComment;
export const sqlLiteral = testPostgres.sqlLiteral;
export const ownerCommentSql = testPostgres.ownerCommentSql;
export const hostProcessProbe = testPostgres.hostProcessProbe;
export const currentDatabaseOwner = testPostgres.currentDatabaseOwner;
export const ownerProcessState = testPostgres.ownerProcessState;
export const decideSweep = testPostgres.decideSweep;
export const decideTemplateRebuild = testPostgres.decideTemplateRebuild;
