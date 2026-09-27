package com.shepherdjerred.thestorm.quests.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.quests.app.QuestStore;
import com.shepherdjerred.thestorm.quests.app.QuestStore.PendingWorld;
import com.shepherdjerred.thestorm.quests.domain.board.Template;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Action.NpcMark;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.state.ActiveQuest;
import com.shepherdjerred.thestorm.quests.domain.state.Board;
import com.shepherdjerred.thestorm.quests.domain.state.Completion;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqQuestStoreTest {

  private static final UUID ALICE = new UUID(1, 1);
  private static final UUID BOB = new UUID(1, 2);
  private static final Instant AT = Instant.parse("2026-09-23T19:00:00.123Z");

  @TempDir Path directory;
  private StormDatabase database;
  private JooqQuestStore store;

  @BeforeEach
  void open() {
    var db = StormDatabase.open(directory.resolve("t.db"));
    db.migrate("quests", getClass().getClassLoader());
    database = db;
    store = new JooqQuestStore(db);
  }

  @AfterEach
  void close() {
    database.close();
  }

  private static PlayerQuests rich(UUID player) {
    return new PlayerQuests(
        player,
        Map.of(
            "smith",
            new ActiveQuest(
                "smith",
                "gather",
                List.of(3, 0, 16),
                ActiveQuest.Phase.IN_PROGRESS,
                AT,
                AT.plusSeconds(5)),
            "pick",
            new ActiveQuest("pick", "decide", List.of(), ActiveQuest.Phase.CHOOSING, AT, AT)),
        Map.of("gift", new Completion(2, AT)),
        Map.of("login-claims", 7L, "debt", -3L),
        Map.of("townsfolk", 4L),
        12,
        Optional.of("smith"),
        new Board(
            "2026-09-23",
            "2026-09-21",
            List.of(
                new Board.Entry(
                    "daily-1",
                    "bounty",
                    Template.Period.DAILY,
                    Template.Kind.KILL,
                    "ZOMBIE",
                    12,
                    2,
                    150L,
                    10),
                new Board.Entry(
                    "weekly-1",
                    "supply",
                    Template.Period.WEEKLY,
                    Template.Kind.DELIVER,
                    "IRON_INGOT",
                    32,
                    4,
                    350L,
                    30))),
        Map.of("nat", NpcMark.TURN_IN, "cade", NpcMark.AVAILABLE));
  }

  @Test
  void aPlayerWithNothingStoredLoadsEmpty() {
    assertThat(store.load(ALICE).join()).isEqualTo(PlayerQuests.empty(ALICE));
  }

  @Test
  void everythingRoundTrips() {
    var state = rich(ALICE);
    store.save(state).join();
    assertThat(store.load(ALICE).join()).isEqualTo(state);
    assertThat(store.load(BOB).join()).isEqualTo(PlayerQuests.empty(BOB));
  }

  @Test
  void aSaveReplacesTheWholeState() {
    store.save(rich(ALICE)).join();
    var smaller = PlayerQuests.empty(ALICE).withPoints(1).withVariable("x", 1);
    store.save(smaller).join();
    assertThat(store.load(ALICE).join()).isEqualTo(smaller);
  }

  @Test
  void committedWorldActionsSurviveStateReplacementUntilAcknowledged() {
    var give =
        new PendingWorld(
            new UUID(4, 1), ALICE, "smith", new Action.Give(ItemMatch.of("IRON_INGOT"), 2));
    var grant = new PendingWorld(new UUID(4, 2), ALICE, "smith", new Action.Grant("storm.test"));
    store.save(rich(ALICE), List.of(give, grant)).join();
    store.save(PlayerQuests.empty(ALICE)).join();
    assertThat(store.pending(ALICE).join()).containsExactly(give, grant);
    store.acknowledge(give.id()).join();
    assertThat(store.pending(ALICE).join()).containsExactly(grant);
  }

  @Test
  void savesLandInTheOrderRequested() {
    var futures = new java.util.ArrayList<java.util.concurrent.CompletableFuture<Void>>();
    for (var points = 0; points < 20; points++) {
      futures.add(store.save(PlayerQuests.empty(ALICE).withPoints(points)));
    }
    futures.forEach(java.util.concurrent.CompletableFuture::join);
    assertThat(store.load(ALICE).join().points()).isEqualTo(19);
  }

  @Test
  void topListsPlayersWithPointsHighestFirst() {
    store.save(PlayerQuests.empty(ALICE).withPoints(5)).join();
    store.save(PlayerQuests.empty(BOB).withPoints(9)).join();
    store.save(PlayerQuests.empty(new UUID(1, 3))).join();
    assertThat(store.top(10).join())
        .containsExactly(new QuestStore.Standing(BOB, 9), new QuestStore.Standing(ALICE, 5));
    assertThat(store.top(1).join()).containsExactly(new QuestStore.Standing(BOB, 9));
  }
}
