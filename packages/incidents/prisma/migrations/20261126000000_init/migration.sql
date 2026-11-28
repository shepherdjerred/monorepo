-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "actors" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metadata" JSONB,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seen_count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "actors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "impact" TEXT,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "systems" TEXT[],
    "components" TEXT[],
    "exit_condition" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "suspect" JSONB,
    "creator_id" UUID,
    "command_state" TEXT NOT NULL DEFAULT 'none',
    "commander_id" UUID,
    "dispatcher_id" UUID,
    "dispatch_token_hash" TEXT,
    "lease_expires_at" TIMESTAMPTZ(6),
    "ever_claimed" BOOLEAN NOT NULL DEFAULT false,
    "takeover_eligible_at" TIMESTAMPTZ(6) NOT NULL,
    "declared_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "mitigated_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_note" TEXT,
    "scheduled_start" TIMESTAMPTZ(6),
    "scheduled_end" TIMESTAMPTZ(6),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "last_event_seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "open_incident_systems" (
    "system" TEXT NOT NULL,
    "incident_id" UUID NOT NULL,

    CONSTRAINT "open_incident_systems_pkey" PRIMARY KEY ("system")
);

-- CreateTable
CREATE TABLE "incident_events" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" UUID,
    "body" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "incident_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_affected" (
    "incident_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "incident_affected_pkey" PRIMARY KEY ("incident_id","actor_id")
);

-- CreateTable
CREATE TABLE "incident_links" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "incident_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_signals" (
    "incident_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "firing" BOOLEAN NOT NULL,
    "first_fired_at" TIMESTAMPTZ(6) NOT NULL,
    "last_changed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "incident_signals_pkey" PRIMARY KEY ("incident_id","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "actors_key_key" ON "actors"("key");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_number_key" ON "incidents"("number");

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "incidents"("status");

-- CreateIndex
CREATE INDEX "incidents_declared_at_idx" ON "incidents"("declared_at");

-- CreateIndex
CREATE INDEX "open_incident_systems_incident_id_idx" ON "open_incident_systems"("incident_id");

-- CreateIndex
CREATE UNIQUE INDEX "incident_events_incident_id_seq_key" ON "incident_events"("incident_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "incident_links_incident_id_kind_ref_key" ON "incident_links"("incident_id", "kind", "ref");

-- CreateIndex
CREATE INDEX "incident_signals_key_idx" ON "incident_signals"("key");

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_commander_id_fkey" FOREIGN KEY ("commander_id") REFERENCES "actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_dispatcher_id_fkey" FOREIGN KEY ("dispatcher_id") REFERENCES "actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_incident_systems" ADD CONSTRAINT "open_incident_systems_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_affected" ADD CONSTRAINT "incident_affected_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_affected" ADD CONSTRAINT "incident_affected_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_links" ADD CONSTRAINT "incident_links_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_signals" ADD CONSTRAINT "incident_signals_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

