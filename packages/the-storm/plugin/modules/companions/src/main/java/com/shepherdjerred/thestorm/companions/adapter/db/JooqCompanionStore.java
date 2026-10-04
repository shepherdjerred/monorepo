package com.shepherdjerred.thestorm.companions.adapter.db;

import static com.shepherdjerred.thestorm.companions.adapter.db.generated.Tables.COMPANION_STATE;

import com.shepherdjerred.thestorm.companions.app.CompanionState;
import com.shepherdjerred.thestorm.companions.app.CompanionStore;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Typed SQL and strict snapshot parsing on the database executors. */
public final class JooqCompanionStore implements CompanionStore {
  private static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(
              DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
              DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES,
              DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
          .build();
  private final StormDatabase database;

  public JooqCompanionStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Map<String, Stored>> load() {
    return database.read(
        dsl ->
            dsl.selectFrom(COMPANION_STATE)
                .fetchMap(
                    row -> java.util.Objects.requireNonNull(row.getId()),
                    row ->
                        new Stored(
                            decode(
                                java.util.Objects.requireNonNull(row.getSnapshot()),
                                java.util.Objects.requireNonNull(row.getNpcUuid())),
                            Optional.ofNullable(row.getPending()))));
  }

  private static CompanionState decode(byte[] bytes, String npcId) {
    var state = JSON.readValue(bytes, CompanionState.class);
    if (!state.npcId().toString().equals(npcId))
      throw new IllegalStateException("companion snapshot identity differs from stored identity");
    return state;
  }

  @Override
  public CompletableFuture<Void> save(String id, CompanionState state) {
    return database
        .write(
            dsl -> {
              var current =
                  dsl.select(COMPANION_STATE.PENDING, COMPANION_STATE.NPC_UUID)
                      .from(COMPANION_STATE)
                      .where(COMPANION_STATE.ID.eq(id))
                      .fetchOne();
              if (current != null && current.value1() != null)
                throw new IllegalStateException("cannot overwrite an unfinished companion effect");
              if (current != null && !state.npcId().toString().equals(current.value2()))
                throw new IllegalStateException("cannot replace a companion identity");
              dsl.insertInto(COMPANION_STATE)
                  .set(COMPANION_STATE.ID, id)
                  .set(COMPANION_STATE.NPC_UUID, state.npcId().toString())
                  .set(COMPANION_STATE.SNAPSHOT, JSON.writeValueAsBytes(state))
                  .onConflict(COMPANION_STATE.ID)
                  .doUpdate()
                  .set(COMPANION_STATE.SNAPSHOT, JSON.writeValueAsBytes(state))
                  .execute();
              return true;
            })
        .thenAccept(ignored -> {});
  }

  @Override
  public CompletableFuture<Void> begin(String id, CompanionState state, String effect) {
    return database
        .write(
            dsl -> {
              var changed =
                  dsl.update(COMPANION_STATE)
                      .set(COMPANION_STATE.SNAPSHOT, JSON.writeValueAsBytes(state))
                      .set(COMPANION_STATE.PENDING, effect)
                      .where(
                          COMPANION_STATE.ID.eq(id),
                          COMPANION_STATE.PENDING.isNull(),
                          COMPANION_STATE.NPC_UUID.eq(state.npcId().toString()))
                      .execute();
              if (changed != 1)
                throw new IllegalStateException(
                    "companion is missing or already has a pending effect");
              return true;
            })
        .thenAccept(ignored -> {});
  }

  @Override
  public CompletableFuture<Void> finish(String id, CompanionState state) {
    return database
        .write(
            dsl -> {
              var changed =
                  dsl.update(COMPANION_STATE)
                      .set(COMPANION_STATE.SNAPSHOT, JSON.writeValueAsBytes(state))
                      .setNull(COMPANION_STATE.PENDING)
                      .where(
                          COMPANION_STATE.ID.eq(id),
                          COMPANION_STATE.PENDING.isNotNull(),
                          COMPANION_STATE.NPC_UUID.eq(state.npcId().toString()))
                      .execute();
              if (changed != 1)
                throw new IllegalStateException("companion has no pending effect to finish");
              return true;
            })
        .thenAccept(ignored -> {});
  }
}
