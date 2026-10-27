package com.shepherdjerred.thestorm.agent.adapter.db;

import static com.shepherdjerred.thestorm.agent.adapter.db.generated.Tables.AGENT_DECISION;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Decisions and review actions associated with one player. */
public final class JooqPlayerReset {

  private final StormDatabase database;

  public JooqPlayerReset(StormDatabase database) {
    this.database = database;
  }

  public CompletableFuture<Void> reset(UUID player) {
    var id = player.toString();
    return database
        .write(
            dsl ->
                dsl.deleteFrom(AGENT_DECISION)
                    .where(
                        AGENT_DECISION
                            .PLAYER
                            .eq(id)
                            .or(AGENT_DECISION.OVERTURNED_BY.eq(id))
                            .or(AGENT_DECISION.ENDORSED_BY.eq(id)))
                    .execute())
        .thenAccept(ignored -> {});
  }
}
