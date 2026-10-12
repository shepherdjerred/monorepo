package com.shepherdjerred.thestorm.rwf.adapter.db;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStats;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore.Outcome;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore.PayoutStatus;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore.PlayerRow;
import com.shepherdjerred.thestorm.rwf.app.store.StatsStore;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** How matches were played, written with the match and read back as careers and leaderboards. */
final class JooqStatsStoreTest {

  private static final UUID ALICE = Samples.ALICE.uuid();
  private static final UUID BOB = Samples.BOB.uuid();

  @TempDir Path directory;
  private StormDatabase database;
  private JooqMatchStore matches;
  private JooqStatsStore stats;
  private int played;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("rwf", getClass().getClassLoader());
    matches = new JooqMatchStore(database);
    stats = new JooqStatsStore(database);
  }

  @AfterEach
  void close() {
    database.close();
  }

  /** A player's line, their best streak as long as their kills. */
  private static MatchStats.PlayerLine line(
      UUID player, String kit, MatchStats.Result result, int kills) {
    var streak = kills;
    return new MatchStats.PlayerLine(
        player,
        player.equals(ALICE) ? "Alice" : "Bob",
        kit,
        result,
        kills,
        1,
        1,
        false,
        streak,
        12.5,
        8,
        1,
        0,
        0,
        2,
        10,
        4,
        1,
        Duration.ofSeconds(90),
        150,
        0);
  }

  private static PlayerRow row(UUID match, UUID player, Outcome outcome, int kills) {
    return new PlayerRow(
        match, player, TeamColor.RED, "trooper", kills, 1, outcome, 0, PayoutStatus.NONE, 0);
  }

  /** Records a match Alice won or lost against Bob, with stats. */
  private UUID play(MatchStats.Result alice, int aliceKills, String aliceKit) {
    var id = UUID.randomUUID();
    var ended = T0.plusSeconds(300L * ++played);
    var bob = alice == MatchStats.Result.WIN ? MatchStats.Result.LOSS : MatchStats.Result.WIN;
    var row =
        new MatchStore.MatchRow(id, "training-yard", T0, ended, Optional.of(TeamColor.RED), 2, 2);
    var details =
        new MatchStats.Details(
            42, Duration.ofMinutes(5), "TEAM_WON", Optional.of("{\"training-yard\":2}"), "abc");
    var event =
        new MatchStats.EventRow(
            0,
            T0.plusSeconds(10),
            "kill",
            Optional.of(ALICE),
            Optional.of(BOB.toString()),
            Optional.of(aliceKit),
            Optional.of("MELEE"),
            OptionalDouble.of(1),
            OptionalDouble.of(64),
            OptionalDouble.of(2),
            "{}");
    matches
        .record(
            row,
            List.of(
                row(
                    id,
                    ALICE,
                    alice == MatchStats.Result.WIN ? Outcome.WIN : Outcome.LOSE,
                    aliceKills),
                row(id, BOB, bob == MatchStats.Result.WIN ? Outcome.WIN : Outcome.LOSE, 0)),
            Optional.of(
                new MatchStats(
                    details,
                    List.of(line(ALICE, aliceKit, alice, aliceKills), line(BOB, "trooper", bob, 0)),
                    List.of(event))))
        .join();
    return id;
  }

  @Test
  void lifetimeTotalsAddUpAndTheWinStreakBreaksOnALoss() {
    play(MatchStats.Result.WIN, 3, "longbow");
    play(MatchStats.Result.WIN, 2, "longbow");
    play(MatchStats.Result.LOSS, 0, "trooper");

    var alice = stats.totals(ALICE).join().orElseThrow();

    assertThat(alice.name()).isEqualTo("Alice");
    assertThat(alice.matches()).isEqualTo(3);
    assertThat(alice.kills()).isEqualTo(5);
    assertThat(alice.assists()).isEqualTo(3);
    assertThat(alice.wins()).isEqualTo(2);
    assertThat(alice.losses()).isEqualTo(1);
    assertThat(alice.winStreak()).isZero();
    assertThat(alice.bestWinStreak()).isEqualTo(2);
    assertThat(alice.bestStreak()).isEqualTo(3);
    assertThat(alice.time()).isEqualTo(Duration.ofSeconds(270));
    assertThat(stats.totals(UUID.randomUUID()).join()).isEmpty();
  }

  @Test
  void leaderboardsRankByTheStatAndHistoryListsTheNewestFirst() {
    play(MatchStats.Result.WIN, 3, "longbow");
    var last = play(MatchStats.Result.LOSS, 1, "shortbow");

    assertThat(stats.top(StatsStore.Stat.KILLS, 10).join())
        .extracting(StatsStore.Totals::player)
        .containsExactly(ALICE, BOB);
    assertThat(stats.top(StatsStore.Stat.WINS, 1).join())
        .extracting(StatsStore.Totals::player)
        .containsExactly(ALICE);
    var history = stats.history(ALICE, 10).join();
    assertThat(history).hasSize(2);
    assertThat(history.getFirst().matchId()).isEqualTo(last);
    assertThat(history.getFirst().assists()).contains(1);
  }

  @Test
  void theLastKitIsRememberedAndTeamChatDefaultsOn() {
    assertThat(stats.prefs(ALICE).join()).isEqualTo(StatsStore.Prefs.DEFAULT);

    play(MatchStats.Result.WIN, 1, "longbow");
    stats.teamChat(ALICE, false).join();

    assertThat(stats.prefs(ALICE).join())
        .isEqualTo(new StatsStore.Prefs(Optional.of("longbow"), false));
    stats.teamChat(BOB, false).join();
    assertThat(stats.prefs(BOB).join().teamChat()).isFalse();
  }

  @Test
  void aMatchRecordedWithoutStatsLeavesTheTotalsAlone() {
    var id = UUID.randomUUID();
    matches
        .record(
            new MatchStore.MatchRow(
                id, "training-yard", T0, T0.plusSeconds(60), Optional.empty(), 1, 1),
            List.of(row(id, ALICE, Outcome.LEFT, 0)))
        .join();

    assertThat(stats.totals(ALICE).join()).isEmpty();
    assertThat(stats.history(ALICE, 5).join())
        .singleElement()
        .satisfies(
            row -> {
              assertThat(row.matchId()).isEqualTo(id);
              assertThat(row.assists()).isEmpty();
            });
  }
}
