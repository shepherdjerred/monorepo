package com.shepherdjerred.thestorm.stats.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.stats.app.StatsConfig;
import com.shepherdjerred.thestorm.stats.app.StatsService;
import com.shepherdjerred.thestorm.stats.app.StatsWire;
import com.shepherdjerred.thestorm.stats.app.StatsWrite;
import com.shepherdjerred.thestorm.stats.domain.BounceCategory;
import com.shepherdjerred.thestorm.stats.domain.CombatClassifier;
import com.shepherdjerred.thestorm.stats.domain.CombatClassifier.CombatActor;
import com.shepherdjerred.thestorm.stats.domain.CombatClassifier.SurvivalContext;
import com.shepherdjerred.thestorm.stats.domain.EndReason;
import com.shepherdjerred.thestorm.stats.domain.GameModeBucket;
import com.shepherdjerred.thestorm.stats.domain.Platform;
import com.shepherdjerred.thestorm.stats.domain.SessionLedger;
import com.shepherdjerred.thestorm.stats.domain.WorldBucket;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.json.JsonMapper;

final class JooqStatsStoreTest {

  private static final UUID ALICE = UUID.fromString("11111111-1111-4111-8111-111111111111");
  private static final UUID BOB = UUID.fromString("22222222-2222-4222-8222-222222222222");
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private static final StatsConfig CONFIG =
      new StatsConfig(
          "The Storm",
          "https://ts-mc.net",
          "STORM_STATS_INGEST_URL",
          "STORM_STATS_INGEST_TOKEN",
          15,
          60);

  @TempDir Path tempDir;

  private StormDatabase database;

  @BeforeEach
  void openDatabase() {
    database = StormDatabase.open(tempDir.resolve("stats-test.db"));
    database.migrate("stats", JooqStatsStore.class.getClassLoader());
  }

  @AfterEach
  void closeDatabase() {
    database.close();
  }

  @Test
  void persistsSummariesPreservesFirstSeenRecoversInterruptedAndResetsPlayer() throws Exception {
    var clock = new AtomicReference<>(Instant.parse("2026-11-22T12:00:00Z"));
    var store = new JooqStatsStore(database);
    var service =
        new StatsService(
            new StatsService.Dependencies(
                CONFIG, store, null, () -> CompletableFuture.completedFuture(true)),
            new StatsService.Clocks(
                clock::get, UUID::randomUUID, LoggerFactory.getLogger(JooqStatsStoreTest.class)));

    var firstJoin = clock.get();
    service.playerJoined(
        new SessionLedger.JoinInput(
            ALICE,
            "Alice",
            firstJoin,
            Platform.JAVA,
            "26.3",
            "vanilla",
            "ts-mc.net:25565",
            WorldBucket.WORLD,
            GameModeBucket.SURVIVAL,
            false));

    clock.set(firstJoin.plusSeconds(60));
    service.checkpointPlayer(
        ALICE,
        new SessionLedger.StateSample(
            clock.get(), WorldBucket.WORLD, GameModeBucket.SURVIVAL, false, 35));

    CombatClassifier.pvp(
            new CombatActor(ALICE, "Alice"),
            new CombatActor(BOB, "Bob"),
            "DIAMOND_SWORD",
            new SurvivalContext(WorldBucket.WORLD, false))
        .ifPresent(service::recordCombat);
    CombatClassifier.pveKill(
            new CombatActor(ALICE, "Alice"),
            "ZOMBIE",
            "DIAMOND_SWORD",
            new SurvivalContext(WorldBucket.WORLD, false))
        .ifPresent(service::recordCombat);

    clock.set(firstJoin.plusSeconds(120));
    service.playerLeft(ALICE, EndReason.DISCONNECT, 45);

    // Second session later that day — left open before simulated crash!
    clock.set(firstJoin.plusSeconds(3600));
    service.playerJoined(
        new SessionLedger.JoinInput(
            ALICE,
            "AliceRenamed",
            clock.get(),
            Platform.JAVA,
            "26.3",
            "vanilla",
            "ts-mc.net",
            WorldBucket.SKYLANDS,
            GameModeBucket.SURVIVAL,
            false));

    var aliceSummary = store.findPlayer("alicerenamed").get().orElseThrow();
    assertThat(aliceSummary.playerUuid()).isEqualTo(ALICE);
    assertThat(aliceSummary.firstSeenAt()).isEqualTo(firstJoin);
    assertThat(aliceSummary.lastSeenAt()).isEqualTo(firstJoin.plusSeconds(3600));
    assertThat(aliceSummary.connectedMs()).isEqualTo(120_000L);
    assertThat(aliceSummary.activeMs()).isEqualTo(120_000L);
    assertThat(aliceSummary.sessionsCount()).isEqualTo(2);
    assertThat(aliceSummary.pvpKills()).isEqualTo(1);
    assertThat(aliceSummary.mobKills()).isEqualTo(1);

    var bobSummary = store.findPlayer(BOB.toString()).get().orElseThrow();
    assertThat(bobSummary.pvpDeaths()).isEqualTo(1);
    assertThat(store.countPlayers().get()).isEqualTo(2);

    // Recover open session on next boot -> emits interrupted session_ended
    int recovered = store.recoverInterrupted(firstJoin.plusSeconds(3700), UUID::randomUUID).get();
    assertThat(recovered).isEqualTo(1);

    var pending = store.pendingEvents(50).get();
    assertThat(pending).hasSize(8);

    // Verify second session_started preserved original firstSeenAt!
    var secondStartJson = JSON.readTree(pending.get(6).eventJson());
    assertThat(secondStartJson.required("type").asString()).isEqualTo("session_started");
    assertThat(secondStartJson.required("firstSeenAt").asString()).isEqualTo(firstJoin.toString());

    var recoveredEndJson = JSON.readTree(pending.get(7).eventJson());
    assertThat(recoveredEndJson.required("type").asString()).isEqualTo("session_ended");
    assertThat(recoveredEndJson.required("endReason").asString()).isEqualTo("interrupted");

    // Reset Alice -> deletes stats_player and stats_open_session
    service.resetPlayer(ALICE).get();
    assertThat(store.findPlayer(ALICE.toString()).get()).isEmpty();
    assertThat(store.countPlayers().get()).isEqualTo(1);
  }

  @Test
  void trimsOutboxToConfiguredCap() throws Exception {
    var store = new JooqStatsStore(database, 3);
    var t0 = Instant.parse("2026-11-22T12:00:00Z");

    for (int i = 0; i < 5; i++) {
      var id = UUID.randomUUID();
      var bounce =
          new StatsWire.ConnectionBounceEvent(
              "connection_bounce",
              id.toString(),
              t0.plusSeconds(i).toString(),
              null,
              "Player" + i,
              BounceCategory.MAINTENANCE.wire(),
              "reason-" + i,
              null);
      store
          .save(
              new StatsWrite(
                  List.of(),
                  null,
                  null,
                  List.of(new StatsWrite.OutboxDraft.Ready(id, t0.plusSeconds(i), bounce))))
          .get();
    }

    var remaining = store.pendingEvents(10).get();
    assertThat(remaining).hasSize(3);
    assertThat(JSON.readTree(remaining.getFirst().eventJson()).required("playerName").asString())
        .isEqualTo("Player2");
    assertThat(JSON.readTree(remaining.getLast().eventJson()).required("playerName").asString())
        .isEqualTo("Player4");
  }
}
