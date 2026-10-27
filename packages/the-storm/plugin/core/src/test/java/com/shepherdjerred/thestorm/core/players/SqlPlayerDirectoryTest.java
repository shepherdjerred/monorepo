package com.shepherdjerred.thestorm.core.players;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class SqlPlayerDirectoryTest {

  private static final UUID RIOT = UUID.fromString("00000000-0000-0000-0000-000000000001");
  private static final UUID OTHER = UUID.fromString("00000000-0000-0000-0000-000000000002");

  @Test
  void findsPlayersByNameIgnoringCaseAndById(@TempDir Path directory) throws Exception {
    try (var database = open(directory)) {
      var players = new SqlPlayerDirectory(database);
      players
          .recordJoin(RIOT, "RiotShielder", Instant.ofEpochMilli(1_000))
          .get(5, TimeUnit.SECONDS);

      assertThat(players.byName("riotshielder").get(5, TimeUnit.SECONDS))
          .contains(new KnownPlayer(RIOT, "RiotShielder", Instant.ofEpochMilli(1_000)));
      assertThat(players.byId(RIOT).get(5, TimeUnit.SECONDS)).isPresent();
      assertThat(players.byName("nobody").get(5, TimeUnit.SECONDS)).isEmpty();
    }
  }

  @Test
  void aRenameUpdatesTheNameAndAReusedNameResolvesToTheLatestPlayer(@TempDir Path directory)
      throws Exception {
    try (var database = open(directory)) {
      var players = new SqlPlayerDirectory(database);
      players.recordJoin(RIOT, "Shep", Instant.ofEpochMilli(1_000)).get(5, TimeUnit.SECONDS);
      players.recordJoin(RIOT, "GeneralShep", Instant.ofEpochMilli(2_000)).get(5, TimeUnit.SECONDS);
      players.recordJoin(OTHER, "Shep", Instant.ofEpochMilli(3_000)).get(5, TimeUnit.SECONDS);

      assertThat(players.byId(RIOT).get(5, TimeUnit.SECONDS).map(KnownPlayer::lastName))
          .contains("GeneralShep");
      assertThat(players.byName("shep").get(5, TimeUnit.SECONDS).map(KnownPlayer::uuid))
          .contains(OTHER);
    }
  }

  @Test
  void resetForgetsOnlyTheDirectoryEntryAndRetainsAnalytics(@TempDir Path directory)
      throws Exception {
    try (var database = open(directory)) {
      var players = new SqlPlayerDirectory(database);
      players.recordJoin(RIOT, "RiotShielder", Instant.EPOCH).get(5, TimeUnit.SECONDS);
      players.recordJoin(OTHER, "Other", Instant.EPOCH).get(5, TimeUnit.SECONDS);
      database
          .write(
              dsl ->
                  dsl.insertInto(
                          org.jooq.impl.DSL.table("core_analytics_player"),
                          org.jooq.impl.DSL.field("player_uuid"),
                          org.jooq.impl.DSL.field("stage"),
                          org.jooq.impl.DSL.field("first_seen"))
                      .values(RIOT.toString(), "survival", 1L)
                      .execute())
          .get(5, TimeUnit.SECONDS);

      players.reset(RIOT).get(5, TimeUnit.SECONDS);

      assertThat(players.byId(RIOT).get(5, TimeUnit.SECONDS)).isEmpty();
      assertThat(players.byId(OTHER).get(5, TimeUnit.SECONDS)).isPresent();
      assertThat(
              database
                  .read(dsl -> dsl.fetchCount(org.jooq.impl.DSL.table("core_analytics_player")))
                  .get(5, TimeUnit.SECONDS))
          .isEqualTo(1);
    }
  }

  private static StormDatabase open(Path directory) {
    var database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("core", SqlPlayerDirectoryTest.class.getClassLoader());
    return database;
  }
}
