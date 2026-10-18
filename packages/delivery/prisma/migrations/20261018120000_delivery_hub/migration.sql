ALTER TABLE "Stage" ADD COLUMN "startedAt" TIMESTAMP(3);
CREATE INDEX "Deployment_versionSetRevisionId_idx" ON "Deployment"("versionSetRevisionId");
CREATE INDEX "Deployment_createdAt_id_idx" ON "Deployment"("createdAt" DESC, "id" DESC);
CREATE INDEX "Build_createdAt_id_idx" ON "Build"("createdAt" DESC, "id" DESC);
CREATE INDEX "Audit_occurredAt_id_idx" ON "Audit"("occurredAt" DESC, "id" DESC);
CREATE TABLE "IntegrationSnapshot" (
  "source" TEXT NOT NULL CHECK ("source" IN ('woodpecker', 'github')),
  "key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "final" BOOLEAN NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("source", "key")
);
-- Commit-ordered change notifications for the browser change feed.
CREATE FUNCTION "delivery_audit_notify"() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'delivery_changes',
    json_build_object('id', NEW."id", 'action', NEW."action", 'entityId', NEW."entityId")::text
  );
  RETURN NULL;
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Audit_notify" AFTER INSERT ON "Audit"
  FOR EACH ROW EXECUTE FUNCTION "delivery_audit_notify"();
