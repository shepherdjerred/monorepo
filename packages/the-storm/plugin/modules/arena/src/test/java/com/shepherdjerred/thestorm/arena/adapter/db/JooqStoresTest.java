package com.shepherdjerred.thestorm.arena.adapter.db;

import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_SNAPSHOT_EFFECTS;
import static com.shepherdjerred.thestorm.arena.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.arena.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.arena.testing.Samples.CAROL;
import static com.shepherdjerred.thestorm.arena.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.arena.app.store.LeaderboardStore;
import com.shepherdjerred.thestorm.arena.app.store.RewardStore;
import com.shepherdjerred.thestorm.arena.domain.snapshot.EffectRecord;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Experience;
import com.shepherdjerred.thestorm.arena.domain.snapshot.ItemData;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Position;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Snapshot;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Vitals;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;
import java.util.OptionalInt;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The repositories against a real, temporary SQLite database. */
final class JooqStoresTest {

  @TempDir Path directory;
  private StormDatabase database;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("arena", getClass().getClassLoader());
  }

  @AfterEach
  void close() {
    database.close();
  }

  private static Snapshot snapshot(UUID player, String arena, List<EffectRecord> effects) {
    return new Snapshot(
        player,
        arena,
        new Position("world", 12.5, 64, -3.25, 90.5f, -10f),
        new Vitals(13.5, 17, 3.5f, 1.25f, "ADVENTURE"),
        new Experience(30, 0.5f, 1395),
        ItemData.of(new byte[] {10, 20, 30, 40}),
        effects,
        T0);
  }

  @Test
  void snapshotsRoundTripExactly() {
    var store = new JooqSnapshotStore(database);
    var alice =
        snapshot(
            ALICE,
            "colosseum",
            List.of(
                new EffectRecord("minecraft:speed", 1, 600, false, true, true),
                new EffectRecord("minecraft:night_vision", 0, -1, true, false, false)));
    var bob = snapshot(BOB, "maze", List.of());

    store.save(alice).join();
    store.save(bob).join();

    assertThat(store.loadAll().join()).containsExactlyInAnyOrder(alice, bob);
  }

  @Test
  void savingAgainReplacesThePlayersSnapshot() {
    var store = new JooqSnapshotStore(database);
    store
        .save(
            snapshot(
                ALICE,
                "colosseum",
                List.of(new EffectRecord("minecraft:speed", 1, 60, false, true, true))))
        .join();
    var newer = snapshot(ALICE, "maze", List.of());

    store.save(newer).join();

    assertThat(store.loadAll().join()).containsExactly(newer);
  }

  @Test
  void deletingRemovesTheSnapshotAndItsEffects() {
    var store = new JooqSnapshotStore(database);
    store
        .save(
            snapshot(
                ALICE,
                "colosseum",
                List.of(new EffectRecord("minecraft:speed", 1, 60, false, true, true))))
        .join();

    store.delete(ALICE).join();
    store.delete(BOB).join();

    assertThat(store.loadAll().join()).isEmpty();
    var orphans = database.read(dsl -> dsl.fetchCount(ARENA_SNAPSHOT_EFFECTS)).join();
    assertThat(orphans).isZero();
  }

  @Test
  void theLeaderboardKeepsEachPlayersBest() {
    var board = new JooqLeaderboardStore(database);
    board.record(new LeaderboardStore.Result(ALICE, "Alice", "colosseum", 30, T0)).join();
    board
        .record(new LeaderboardStore.Result(ALICE, "Alice2", "colosseum", 12, T0.plusSeconds(60)))
        .join();
    board
        .record(new LeaderboardStore.Result(BOB, "Bob", "colosseum", 45, T0.plusSeconds(5)))
        .join();
    board
        .record(new LeaderboardStore.Result(CAROL, "Carol", "colosseum", 30, T0.plusSeconds(10)))
        .join();
    board.record(new LeaderboardStore.Result(CAROL, "Carol", "maze", 72, T0)).join();

    assertThat(board.top("colosseum", 10).join())
        .containsExactly(
            new LeaderboardStore.Standing("Bob", 45),
            new LeaderboardStore.Standing("Alice2", 30),
            new LeaderboardStore.Standing("Carol", 30));
    assertThat(board.top("colosseum", 1).join()).hasSize(1);
    assertThat(board.best(ALICE, "colosseum").join()).isEqualTo(OptionalInt.of(30));
    assertThat(board.bestWave(CAROL, "maze").join()).isEqualTo(OptionalInt.of(72));
    assertThat(board.best(ALICE, "maze").join()).isEmpty();
  }

  @Test
  void aBetterResultReplacesTheOldOne() {
    var board = new JooqLeaderboardStore(database);
    board.record(new LeaderboardStore.Result(ALICE, "Alice", "colosseum", 10, T0)).join();

    board
        .record(new LeaderboardStore.Result(ALICE, "Alice", "colosseum", 11, T0.plusSeconds(1)))
        .join();

    assertThat(board.best(ALICE, "colosseum").join()).isEqualTo(OptionalInt.of(11));
  }

  @Test
  void aVaultOpensOncePerPlayerPerMilestonePerDay() {
    var rewards = new JooqRewardStore(database);
    var day = LocalDate.of(2026, 9, 25);
    var loot = ItemData.of(new byte[] {7, 7, 7});

    assertThat(rewards.claimVault(new RewardStore.VaultClaim(ALICE, 20, day, loot, T0)).join())
        .isEqualTo(RewardStore.Claim.OPENED);
    assertThat(rewards.claimVault(new RewardStore.VaultClaim(ALICE, 20, day, loot, T0)).join())
        .isEqualTo(RewardStore.Claim.ALREADY_OPENED);
    assertThat(rewards.claimVault(new RewardStore.VaultClaim(ALICE, 30, day, loot, T0)).join())
        .isEqualTo(RewardStore.Claim.OPENED);
    assertThat(
            rewards
                .claimVault(new RewardStore.VaultClaim(ALICE, 20, day.plusDays(1), loot, T0))
                .join())
        .isEqualTo(RewardStore.Claim.OPENED);
    assertThat(rewards.claimVault(new RewardStore.VaultClaim(BOB, 20, day, loot, T0)).join())
        .isEqualTo(RewardStore.Claim.OPENED);

    var waiting = rewards.claimAll(ALICE).join();
    assertThat(waiting).hasSize(3);
    assertThat(waiting)
        .extracting(RewardStore.PendingReward::reason)
        .containsExactly("vault:wave20", "vault:wave30", "vault:wave20");
    assertThat(waiting.getFirst().items()).isEqualTo(loot);
  }

  @Test
  void claimingTakesTheLootOutSoItIsHandedOutOnce() {
    var rewards = new JooqRewardStore(database);
    var loot = ItemData.of(new byte[] {1});
    var day = LocalDate.of(2026, 9, 25);
    rewards.claimVault(new RewardStore.VaultClaim(ALICE, 10, day, loot, T0)).join();
    rewards.claimVault(new RewardStore.VaultClaim(BOB, 10, day, loot, T0)).join();

    var first = rewards.claimAll(ALICE).join();
    var second = rewards.claimAll(ALICE).join();

    assertThat(first).singleElement().satisfies(r -> assertThat(r.items()).isEqualTo(loot));
    assertThat(second).isEmpty();
    assertThat(rewards.claimAll(BOB).join()).hasSize(1);
  }

  @Test
  void claimedLootThatCouldNotBeGivenIsPutBack() {
    var rewards = new JooqRewardStore(database);
    var loot = ItemData.of(new byte[] {4, 2});
    rewards
        .claimVault(new RewardStore.VaultClaim(ALICE, 20, LocalDate.of(2026, 9, 25), loot, T0))
        .join();
    var claimed = rewards.claimAll(ALICE).join();

    rewards.requeue(ALICE, claimed, T0.plusSeconds(5)).join();

    assertThat(rewards.claimAll(ALICE).join())
        .singleElement()
        .satisfies(
            reward -> {
              assertThat(reward.reason()).isEqualTo("vault:wave20");
              assertThat(reward.items()).isEqualTo(loot);
            });
  }
}
