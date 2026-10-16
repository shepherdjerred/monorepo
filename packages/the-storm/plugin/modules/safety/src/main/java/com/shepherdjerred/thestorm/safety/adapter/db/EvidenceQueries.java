package com.shepherdjerred.thestorm.safety.adapter.db;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.table;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.safety.ContentSubmission;
import com.shepherdjerred.thestorm.core.safety.EvidenceAccess;
import com.shepherdjerred.thestorm.safety.app.EvidenceQuery;
import com.shepherdjerred.thestorm.safety.domain.ContentRules;
import java.time.Instant;
import java.time.InstantSource;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Indexed, paginated queries and their access trail share the same serialized SQLite writer. */
public final class EvidenceQueries implements EvidenceAccess {
  private final StormDatabase database;
  private final JooqEvidenceStore store;
  private final InstantSource time;
  private final java.util.random.RandomGenerator random;
  private final JsonMapper json =
      JsonMapper.builder()
          .enable(
              DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
              DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES,
              DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
          .build();

  public EvidenceQueries(
      StormDatabase database,
      JooqEvidenceStore store,
      InstantSource time,
      java.util.random.RandomGenerator random) {
    this.database = database;
    this.store = store;
    this.time = time;
    this.random = random;
    var contract =
        com.shepherdjerred.thestorm.safety.adapter.contract.SharedContracts.load(
            "evidence-contract");
    com.shepherdjerred.thestorm.safety.adapter.contract.SharedContracts.fields(
        contract, "requestFields", EvidenceQuery.class);
    if (contract.required("maxPageSize").asInt() != 1000)
      throw new IllegalStateException("Evidence page limits differ from contract");
    if (!java.util.Set.copyOf(
            com.shepherdjerred.thestorm.safety.adapter.contract.SharedContracts.strings(
                contract, "actions"))
        .equals(EvidenceQuery.ACTIONS))
      throw new IllegalStateException("Evidence actions differ from contract");
  }

  @Override
  public CompletableFuture<String> query(String raw, String accessor) {
    var query = parse(raw);
    var id = new UUID(random.nextLong(), random.nextLong());
    var audit =
        new ContentSubmission(
            id,
            new UUID(0, 0),
            accessor,
            "evidence-access",
            "staff",
            ContentRules.redact(raw),
            "",
            "");
    return store
        .attempt(audit, time.instant())
        .thenCompose(
            done ->
                database.read(
                    dsl -> {
                      var selected =
                          dsl.select(
                                  field("rowid", Long.class).as("sequence"),
                                  field("id"),
                                  field("player"),
                                  field("name"),
                                  field("surface"),
                                  field("audience"),
                                  field("object_ref"),
                                  field("original_text"),
                                  field("components"),
                                  field("created_at"))
                              .from(table("safety_submission"))
                              .where(field("surface", String.class).ne("evidence-access"));
                      if (query.action().equals("show"))
                        selected = selected.and(field("id", String.class).eq(query.id()));
                      else {
                        selected =
                            selected
                                .and(
                                    field("player", String.class)
                                        .containsIgnoreCase(query.player())
                                        .or(
                                            field("name", String.class)
                                                .containsIgnoreCase(query.player())))
                                .and(
                                    field("original_text", String.class)
                                        .containsIgnoreCase(query.text()))
                                .and(
                                    field("surface", String.class)
                                        .containsIgnoreCase(query.surface()))
                                .and(
                                    field("created_at", String.class)
                                        .ge(JooqEvidenceStore.stamp(Instant.parse(query.since()))))
                                .and(
                                    field("created_at", String.class)
                                        .le(JooqEvidenceStore.stamp(Instant.parse(query.until()))));
                        if (query.action().equals("export"))
                          selected = selected.and(field("rowid", Long.class).gt(query.after()));
                      }
                      var rows =
                          selected
                              .orderBy(
                                  query.action().equals("export")
                                      ? field("rowid").asc()
                                      : field("rowid").desc())
                              .limit(query.limit())
                              .fetch();
                      var ids = rows.getValues("id", String.class);
                      var events =
                          dsl.selectFrom(table("safety_event"))
                              .where(field("submission_id", String.class).in(ids))
                              .and(
                                  field("created_at", String.class)
                                      .le(JooqEvidenceStore.stamp(Instant.parse(query.until()))))
                              .orderBy(field("sequence"))
                              .fetch()
                              .intoMaps();
                      long next =
                          rows.isEmpty()
                              ? query.after()
                              : rows.getLast().get("sequence", Long.class);
                      return json.writeValueAsString(
                          Map.of(
                              "version",
                              1,
                              "rows",
                              rows.intoMaps(),
                              "events",
                              events,
                              "next",
                              next,
                              "hasMore",
                              rows.size() == query.limit()));
                    }))
        .thenCompose(
            result ->
                store.event(id, "evidence-viewed", "", time.instant()).thenApply(done -> result));
  }

  private EvidenceQuery parse(String raw) {
    try {
      return json.readValue(raw, EvidenceQuery.class);
    } catch (RuntimeException invalid) {
      // Jackson diagnostics can contain excerpts from the private query.
      throw new IllegalArgumentException("Invalid evidence query");
    }
  }
}
