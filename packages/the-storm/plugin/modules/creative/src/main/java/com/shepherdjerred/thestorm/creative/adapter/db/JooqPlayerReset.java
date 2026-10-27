package com.shepherdjerred.thestorm.creative.adapter.db;

import static com.shepherdjerred.thestorm.creative.adapter.db.generated.Tables.CREATIVE_BODIES;
import static com.shepherdjerred.thestorm.creative.adapter.db.generated.Tables.CREATIVE_CLAIMS;
import static com.shepherdjerred.thestorm.creative.adapter.db.generated.Tables.CREATIVE_COMMENTS;
import static com.shepherdjerred.thestorm.creative.adapter.db.generated.Tables.CREATIVE_RATINGS;
import static com.shepherdjerred.thestorm.creative.adapter.db.generated.Tables.CREATIVE_TRUST;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Creative bodies, plot ownership, trust and reviews for one account. */
public final class JooqPlayerReset {

  private final StormDatabase database;

  public JooqPlayerReset(StormDatabase database) {
    this.database = database;
  }

  public CompletableFuture<Void> reset(UUID player) {
    var id = player.toString();
    return database
        .write(
            dsl -> {
              dsl.deleteFrom(CREATIVE_BODIES).where(CREATIVE_BODIES.PLAYER.eq(id)).execute();
              dsl.deleteFrom(CREATIVE_TRUST).where(CREATIVE_TRUST.MEMBER.eq(id)).execute();
              dsl.deleteFrom(CREATIVE_RATINGS).where(CREATIVE_RATINGS.PLAYER.eq(id)).execute();
              dsl.deleteFrom(CREATIVE_COMMENTS).where(CREATIVE_COMMENTS.PLAYER.eq(id)).execute();
              dsl.deleteFrom(CREATIVE_CLAIMS).where(CREATIVE_CLAIMS.OWNER.eq(id)).execute();
              return true;
            })
        .thenAccept(ignored -> {});
  }
}
