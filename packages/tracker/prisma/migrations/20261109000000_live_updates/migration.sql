-- Commit-ordered change notifications for the browser's live-update stream.
-- NOTIFY is queued inside the writing transaction and delivered only when it
-- commits, so a listener never learns of a change it cannot yet read. The
-- payload names the change and omits "changes", "before" and "after" to stay
-- far below PostgreSQL's 8000-byte NOTIFY limit.
CREATE FUNCTION "tracker_event_notify"() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'tracker_events',
    json_build_object(
      'eventId', NEW."id",
      'entityType', NEW."entityType",
      'entityId', NEW."entityId",
      'issueIdentifier', NEW."issueIdentifier",
      'action', NEW."action",
      'actorId', NEW."actorId",
      'requestId', NEW."requestId",
      -- "occurredAt" is a UTC timestamp without time zone.
      'occurredAt', to_char(NEW."occurredAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )::text
  );
  RETURN NULL;
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Event_notify" AFTER INSERT ON "Event"
  FOR EACH ROW EXECUTE FUNCTION "tracker_event_notify"();
