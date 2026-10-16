package com.shepherdjerred.thestorm.safety.adapter.db;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.table;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.safety.ContentSubmission;
import com.shepherdjerred.thestorm.safety.app.EvidenceStore;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** All values are bound parameters; evidence stays in the backed-up game volume. */
public final class JooqEvidenceStore implements EvidenceStore {
  private static final java.time.format.DateTimeFormatter TIME =
      new java.time.format.DateTimeFormatterBuilder().appendInstant(9).toFormatter();

  public static String stamp(Instant instant) {
    return TIME.format(instant);
  }

  private final StormDatabase database;

  public JooqEvidenceStore(StormDatabase database) {
    this.database = database;
  }

  /** A crash between admission and its receipt never causes an automatic replay on restart. */
  public CompletableFuture<Integer> recover(Instant at) {
    return database.write(
        dsl ->
            dsl.insertInto(table("safety_event"))
                .columns(
                    field("submission_id", String.class),
                    field("outcome", String.class),
                    field("details", String.class),
                    field("created_at", String.class))
                .select(
                    dsl.select(
                            field("id", String.class),
                            org.jooq.impl.DSL.val("interrupted"),
                            org.jooq.impl.DSL.val(
                                "Publication status unknown after restart; content was not replayed."),
                            org.jooq.impl.DSL.val(stamp(at)))
                        .from(table("safety_submission"))
                        .whereNotExists(
                            dsl.selectOne()
                                .from(table("safety_event"))
                                .where(
                                    field("submission_id", String.class)
                                        .eq(field("safety_submission.id", String.class)))
                                .and(
                                    field("outcome", String.class)
                                        .notIn(
                                            "decision",
                                            "window-decision",
                                            "advertising",
                                            "penalty-intent",
                                            "penalty"))))
                .execute());
  }

  @Override
  public CompletableFuture<Void> attempt(ContentSubmission submission, Instant at) {
    return database
        .write(
            dsl -> {
              dsl.insertInto(table("safety_submission"))
                  .columns(
                      field("id"),
                      field("player"),
                      field("name"),
                      field("surface"),
                      field("audience"),
                      field("object_ref"),
                      field("original_text"),
                      field("components"),
                      field("created_at"))
                  .values(
                      submission.id().toString(),
                      submission.player().toString(),
                      submission.name(),
                      submission.surface(),
                      submission.audience(),
                      submission.object(),
                      submission.text(),
                      submission.components(),
                      stamp(at))
                  .execute();
              return true;
            })
        .thenAccept(done -> {});
  }

  @Override
  public CompletableFuture<Void> event(
      UUID submission, String outcome, String details, Instant at) {
    return database
        .write(
            dsl -> {
              dsl.insertInto(table("safety_event"))
                  .columns(
                      field("submission_id"),
                      field("outcome"),
                      field("details"),
                      field("created_at"))
                  .values(submission.toString(), outcome, details, stamp(at))
                  .execute();
              return true;
            })
        .thenAccept(done -> {});
  }

  @Override
  public CompletableFuture<List<Entry>> recent(UUID player, Instant since, int limit) {
    return database.read(
        dsl ->
            dsl.selectFrom(table("safety_submission"))
                .where(
                    field("player", String.class)
                        .eq(player.toString())
                        .and(field("created_at", String.class).ge(stamp(since)))
                        .and(
                            field("surface", String.class)
                                .notIn("activity", "anticheat", "evidence-access")))
                .orderBy(field("created_at").desc())
                .limit(limit)
                .fetch(
                    row ->
                        new Entry(
                            new ContentSubmission(
                                UUID.fromString(row.get("id", String.class)),
                                player,
                                row.get("name", String.class),
                                row.get("surface", String.class),
                                row.get("audience", String.class),
                                row.get("original_text", String.class),
                                row.get("components", String.class),
                                row.get("object_ref", String.class)),
                            Instant.parse(row.get("created_at", String.class)))));
  }

  @Override
  public CompletableFuture<String> search(String player, String text, int limit) {
    return database.read(
        dsl ->
            dsl.selectFrom(table("safety_submission"))
                .where(
                    field("player", String.class)
                        .containsIgnoreCase(player)
                        .or(field("name", String.class).containsIgnoreCase(player)))
                .and(field("original_text", String.class).containsIgnoreCase(text))
                .orderBy(field("created_at").desc())
                .limit(limit)
                .fetch()
                .formatJSON());
  }

  @Override
  public CompletableFuture<Integer> strikes(UUID player, String outcome, Instant since) {
    return count(player, outcome, since, Instant.parse("9999-12-31T23:59:59Z"));
  }

  @Override
  public CompletableFuture<Integer> advertisingWarnings(
      UUID player, Instant since, Instant before) {
    return count(player, "advertising-warned", since, before);
  }

  private CompletableFuture<Integer> count(
      UUID player, String outcome, Instant since, Instant before) {
    return database.read(
        dsl ->
            dsl.selectCount()
                .from(table("safety_event"))
                .join(table("safety_submission"))
                .on(
                    field("safety_submission.id", String.class)
                        .eq(field("safety_event.submission_id", String.class)))
                .where(field("safety_submission.player", String.class).eq(player.toString()))
                .and(field("safety_event.outcome", String.class).eq(outcome))
                .and(field("safety_event.created_at", String.class).ge(stamp(since)))
                .and(field("safety_event.created_at", String.class).le(stamp(before)))
                .andNotExists(
                    dsl.selectOne()
                        .from(table("safety_event").as("correction"))
                        .where(
                            field("correction.submission_id", String.class)
                                .eq(field("safety_submission.id", String.class)))
                        .and(field("correction.outcome", String.class).eq("overturned")))
                .fetchSingle(0, int.class));
  }

  @Override
  public CompletableFuture<List<Entry>> context(String audience, Instant since, int limit) {
    return database.read(
        dsl ->
            dsl.selectFrom(table("safety_submission"))
                .where(field("audience", String.class).eq(audience))
                .and(field("created_at", String.class).ge(stamp(since)))
                .and(
                    field("id", String.class)
                        .in(
                            dsl.select(field("submission_id", String.class))
                                .from(table("safety_event"))
                                .where(
                                    field("outcome", String.class)
                                        .in(
                                            "delivered",
                                            "command-dispatched",
                                            "discord-delivered"))))
                .orderBy(field("created_at").desc())
                .limit(limit)
                .fetch(
                    row ->
                        new Entry(
                            new ContentSubmission(
                                UUID.fromString(row.get("id", String.class)),
                                UUID.fromString(row.get("player", String.class)),
                                row.get("name", String.class),
                                row.get("surface", String.class),
                                row.get("audience", String.class),
                                row.get("original_text", String.class),
                                row.get("components", String.class),
                                row.get("object_ref", String.class)),
                            Instant.parse(row.get("created_at", String.class)))));
  }
}
