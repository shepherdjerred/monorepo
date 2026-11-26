CREATE TYPE "ExperimentStatus" AS ENUM ('draft', 'running', 'decided');

CREATE TABLE "experiments" (
    "id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "status" "ExperimentStatus" NOT NULL,
    "review_date" DATE,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "state" JSONB NOT NULL,
    CONSTRAINT "experiments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "experiment_mutations" (
    "request_id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "experiment_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "event" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    CONSTRAINT "experiment_mutations_pkey" PRIMARY KEY ("request_id"),
    CONSTRAINT "experiment_mutations_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "experiments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "experiments_status_review_date_idx" ON "experiments" ("status", "review_date");
CREATE UNIQUE INDEX "experiment_mutations_experiment_id_revision_key" ON "experiment_mutations" ("experiment_id", "revision");
