-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "IssueState" AS ENUM ('OPEN', 'RESOLVED', 'RESOLVED_NEXT_RELEASE', 'MUTED');

-- CreateEnum
CREATE TYPE "OutboxKind" AS ENUM ('NEW_ISSUE', 'REGRESSION');

-- CreateTable
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "digested_event_count" BIGINT NOT NULL DEFAULT 0,
    "stored_event_count" INTEGER NOT NULL DEFAULT 0,
    "alert_on_new_issue" BOOLEAN NOT NULL DEFAULT true,
    "alert_on_regression" BOOLEAN NOT NULL DEFAULT true,
    "retention_max_events" INTEGER NOT NULL DEFAULT 50,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" UUID NOT NULL,
    "project_id" INTEGER NOT NULL,
    "primary_fingerprint" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "transaction" TEXT NOT NULL DEFAULT '',
    "level" TEXT NOT NULL DEFAULT 'error',
    "state" "IssueState" NOT NULL DEFAULT 'OPEN',
    "resolved_in_release" TEXT,
    "regressed_count" INTEGER NOT NULL DEFAULT 0,
    "digested_event_count" BIGINT NOT NULL DEFAULT 1,
    "stored_event_count" INTEGER NOT NULL DEFAULT 0,
    "first_seen" TIMESTAMPTZ(6) NOT NULL,
    "last_seen" TIMESTAMPTZ(6) NOT NULL,
    "last_release" TEXT,
    "last_alerted_at" TIMESTAMPTZ(6),
    "tracker_issue_identifier" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_fingerprints" (
    "project_id" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "issue_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_fingerprints_pkey" PRIMARY KEY ("project_id","fingerprint")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "issue_id" UUID NOT NULL,
    "project_id" INTEGER NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "ingested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "release" TEXT,
    "environment" TEXT,
    "platform" TEXT,
    "level" TEXT NOT NULL DEFAULT 'error',
    "transaction" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL,
    "stacktrace_md" TEXT NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "releases" (
    "id" UUID NOT NULL,
    "project_id" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "released_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "kind" "OutboxKind" NOT NULL,
    "message_id" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "projects_public_key_key" ON "projects"("public_key");

-- CreateIndex
CREATE INDEX "issues_project_id_state_last_seen_idx" ON "issues"("project_id", "state", "last_seen" DESC);

-- CreateIndex
CREATE INDEX "issues_state_last_seen_idx" ON "issues"("state", "last_seen" DESC);

-- CreateIndex
CREATE INDEX "issue_fingerprints_issue_id_idx" ON "issue_fingerprints"("issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "events_project_id_event_id_key" ON "events"("project_id", "event_id");

-- CreateIndex
CREATE INDEX "events_issue_id_timestamp_idx" ON "events"("issue_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "events_timestamp_idx" ON "events"("timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "releases_project_id_version_key" ON "releases"("project_id", "version");

-- CreateIndex
CREATE INDEX "releases_project_id_released_at_idx" ON "releases"("project_id", "released_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_message_id_key" ON "notification_outbox"("message_id");

-- CreateIndex
CREATE INDEX "notification_outbox_sent_at_next_attempt_at_idx" ON "notification_outbox"("sent_at", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_fingerprints" ADD CONSTRAINT "issue_fingerprints_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_fingerprints" ADD CONSTRAINT "issue_fingerprints_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
