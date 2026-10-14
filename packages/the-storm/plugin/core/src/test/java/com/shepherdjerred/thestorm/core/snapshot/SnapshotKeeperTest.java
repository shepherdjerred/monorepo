package com.shepherdjerred.thestorm.core.snapshot;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.Plugin;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * The lifted lifecycle on MockBukkit, over an in-memory store, pretend saved player data, a main
 * thread the test drives, and a game's own marker key.
 */
final class SnapshotKeeperTest {

  private static final Instant T0 = Instant.parse("2026-09-25T12:00:00Z");

  /** Longer than every confirmation retry together. */
  private static final Duration ALL_RETRIES = Duration.ofSeconds(20);

  private final MemoryStore store = new MemoryStore();
  private final MemorySavedData saved = new MemorySavedData();
  private ServerMock server;
  private Plugin plugin;
  private RestoreMarker marker;
  private ManualScheduler main;
  private SnapshotKeeper keeper;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    server.addSimpleWorld("world");
    plugin = MockBukkit.createMockPlugin("TheStorm");
    marker = new RestoreMarker(plugin, "match_restored_snapshot");
    main = new ManualScheduler();
    keeper = keeper(main, saved);
    keeper.load(() -> {});
    main.settle();
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private SnapshotKeeper keeper(ManualScheduler scheduler, SavedPlayerData data) {
    return new SnapshotKeeper(
        new SnapshotKeeper.Parts(plugin, scheduler, InstantSource.fixed(T0), store, marker, data));
  }

  private PlayerMock alice() {
    var alice = server.addPlayer("Alice");
    alice.setGameMode(GameMode.SURVIVAL);
    alice.getInventory().setItem(0, new ItemStack(Material.DIAMOND_SWORD));
    alice.setLevel(7);
    return alice;
  }

  private static int swords(PlayerMock player) {
    return player.getInventory().all(Material.DIAMOND_SWORD).values().stream()
        .mapToInt(ItemStack::getAmount)
        .sum();
  }

  /** Alice joins a match: captured, stored, and her emptied self saved to disk by Paper. */
  private PlayerMock joined() {
    var alice = alice();
    keeper.capture(alice, "match-1", ignored -> {});
    main.settle();
    var _ = saved.save(alice);
    saved.saves = 0;
    return alice;
  }

  @Test
  void aRestoreIsConfirmedFromSavedPlayerDataWithoutANewLogin() {
    var alice = alice();
    var stored = new AtomicReference<@Nullable Boolean>();

    keeper.capture(alice, "match-1", stored::set);

    assertThat(alice.getInventory().isEmpty()).isTrue();
    assertThat(alice.getLevel()).isZero();
    assertThat(keeper.holds(alice.getUniqueId())).isTrue();
    assertThat(keeper.refusal(alice.getUniqueId())).contains(SnapshotBook.Refusal.RESTORE_PENDING);
    main.settle();
    assertThat(stored.get()).isTrue();
    var row = Objects.requireNonNull(store.rows.get(alice.getUniqueId()));
    assertThat(row.scope()).isEqualTo("match-1");

    assertThat(keeper.restore(alice)).isEqualTo(SnapshotKeeper.Outcome.RESTORED);

    // Saved in the same tick, with the marker and the belongings in one file.
    assertThat(saved.saves).isEqualTo(1);
    assertThat(alice.getInventory().getItem(0)).isEqualTo(new ItemStack(Material.DIAMOND_SWORD));
    assertThat(alice.getLevel()).isEqualTo(7);
    assertThat(marker.matches(alice, row)).isTrue();
    assertThat(keeper.holds(alice.getUniqueId())).isFalse();
    assertThat(keeper.refusal(alice.getUniqueId())).contains(SnapshotBook.Refusal.CLEANUP_PENDING);
    assertThat(store.restoredAt).doesNotContainKey(alice.getUniqueId());

    main.settle();

    assertThat(store.restoredAt).containsEntry(alice.getUniqueId(), T0);
    assertThat(store.rows).doesNotContainKey(alice.getUniqueId());
    assertThat(keeper.refusal(alice.getUniqueId())).isEmpty();
  }

  @Test
  void aJoinRefusedWhileConfirmingIsRetriedOnceConfirmed() {
    var alice = joined();
    saved.lagReads = true;
    keeper.restore(alice);
    var retried = new AtomicInteger();

    keeper.whenClean(alice.getUniqueId(), retried::incrementAndGet);
    main.runFor(ALL_RETRIES);

    assertThat(retried).hasValue(0);
    assertThat(keeper.refusal(alice.getUniqueId())).contains(SnapshotBook.Refusal.CLEANUP_PENDING);

    saved.release();
    main.settle();

    assertThat(retried).hasValue(1);
    assertThat(keeper.refusal(alice.getUniqueId())).isEmpty();
  }

  @Test
  void aSaveThatNeverLandsIsReadAgainThenStallsUntilALogin() {
    var alice = joined();
    saved.dropWrites = true;
    keeper.restore(alice);
    var retried = new AtomicInteger();
    keeper.whenClean(alice.getUniqueId(), retried::incrementAndGet);

    main.runFor(Duration.ofSeconds(14));
    assertThat(keeper.refusal(alice.getUniqueId())).contains(SnapshotBook.Refusal.CLEANUP_PENDING);
    main.runFor(Duration.ofSeconds(2));

    // One save on the tick thread; the file is read again after the 1, 2, 4 and 8 second waits.
    assertThat(saved.saves).isEqualTo(1);
    assertThat(saved.reads).isEqualTo(5);
    assertThat(keeper.refusal(alice.getUniqueId())).contains(SnapshotBook.Refusal.CLEANUP_STALLED);
    assertThat(retried).hasValue(1);
    assertThat(store.rows).containsKey(alice.getUniqueId());
    assertThat(store.restoredAt).doesNotContainKey(alice.getUniqueId());

    // Paper saves on quit; the next login carries the marker and proves the restore.
    saved.dropWrites = false;
    var _ = saved.save(alice);
    saved.load(alice);
    assertThat(keeper.recover(alice, true)).isEqualTo(SnapshotKeeper.Outcome.PROOF_PENDING);
    main.settle();

    assertThat(store.rows).doesNotContainKey(alice.getUniqueId());
    assertThat(keeper.refusal(alice.getUniqueId())).isEmpty();
    assertThat(swords(alice)).isEqualTo(1);
  }

  @Test
  void aCorruptReadIsRetriedAndConfirmedOnceTheFileReadsWhole() {
    var alice = joined();
    saved.corrupt = 2;

    keeper.restore(alice);
    main.settle();
    assertThat(keeper.refusal(alice.getUniqueId())).contains(SnapshotBook.Refusal.CLEANUP_PENDING);
    main.runFor(Duration.ofSeconds(3));

    assertThat(saved.reads).isEqualTo(3);
    assertThat(store.rows).doesNotContainKey(alice.getUniqueId());
    assertThat(keeper.refusal(alice.getUniqueId())).isEmpty();
  }

  @Test
  void anOlderFileWithoutTheMarkerIsNeverTakenAsProof() {
    var alice = joined();
    saved.dropWrites = true;

    keeper.restore(alice);
    main.runFor(ALL_RETRIES);

    // Every read found the file saved at join time: no marker, so the row stays unrestored.
    assertThat(saved.reads).isEqualTo(5);
    assertThat(store.restoredAt).doesNotContainKey(alice.getUniqueId());
    assertThat(keeper.refusal(alice.getUniqueId())).contains(SnapshotBook.Refusal.CLEANUP_STALLED);
  }

  @Test
  void aConfirmationFinishingAfterThePlayerLeftStillRetiresTheRow() {
    var alice = joined();
    saved.lagReads = true;
    keeper.restore(alice);
    var _ = alice.disconnect();

    saved.release();
    main.settle();

    assertThat(store.restoredAt).containsKey(alice.getUniqueId());
    assertThat(keeper.refusal(alice.getUniqueId())).isEmpty();
  }

  @Test
  void aPlayerWhoLeavesBeforeTheReadBackIsStillProvenFromTheirSavedFile() {
    var alice = joined();
    saved.corrupt = 1;
    keeper.restore(alice);
    main.settle();
    var _ = alice.disconnect();

    main.runFor(ALL_RETRIES);

    // The retry only reads the file the restore saved, so leaving does not stop the proof.
    assertThat(saved.saves).isEqualTo(1);
    assertThat(store.rows).doesNotContainKey(alice.getUniqueId());
    assertThat(keeper.refusal(alice.getUniqueId())).isEmpty();
  }

  @Test
  void withoutReadablePlayerDataARestoreWaitsForALogin() {
    var unreadable = new ManualScheduler();
    var restarted = keeper(unreadable, SavedPlayerData.UNAVAILABLE);
    restarted.load(() -> {});
    unreadable.settle();
    var alice = alice();
    restarted.capture(alice, "match-1", ignored -> {});
    unreadable.settle();

    restarted.restore(alice);
    unreadable.settle();

    assertThat(restarted.refusal(alice.getUniqueId()))
        .contains(SnapshotBook.Refusal.CLEANUP_STALLED);
    assertThat(restarted.recover(alice, true)).isEqualTo(SnapshotKeeper.Outcome.PROOF_PENDING);
    unreadable.settle();
    assertThat(restarted.refusal(alice.getUniqueId())).isEmpty();
  }

  @Test
  void aFailedStorePutsThePlayerBackFromMemory() {
    var alice = alice();
    alice.setAllowFlight(true);
    alice.setFlying(true);
    alice.setFlySpeed(0.3f);
    alice.setMaximumNoDamageTicks(13);
    store.failSaves = true;
    var stored = new AtomicReference<@Nullable Boolean>();

    keeper.capture(alice, "match-1", stored::set);
    assertThat(alice.getInventory().isEmpty()).isTrue();
    main.settle();

    assertThat(stored.get()).isFalse();
    assertThat(alice.getInventory().getItem(0)).isEqualTo(new ItemStack(Material.DIAMOND_SWORD));
    assertThat(keeper.holds(alice.getUniqueId())).isFalse();
    assertThat(keeper.refusal(alice.getUniqueId())).isEmpty();
    assertThat(alice.getAllowFlight()).isTrue();
    assertThat(alice.isFlying()).isTrue();
    assertThat(alice.getFlySpeed()).isEqualTo(0.3f);
    assertThat(alice.getMaximumNoDamageTicks()).isEqualTo(13);
  }

  @Test
  void aDeadPlayerIsRestoredOnceTheyRespawn() {
    var alice = alice();
    keeper.capture(alice, "match-1", ignored -> {});
    main.settle();
    alice.setHealth(0);

    assertThat(keeper.restore(alice)).isEqualTo(SnapshotKeeper.Outcome.AWAITING_RESPAWN);
    assertThat(keeper.waitsForRespawn(alice.getUniqueId())).isTrue();
    assertThat(alice.getInventory().isEmpty()).isTrue();

    alice.respawn();
    assertThat(keeper.respawned(alice.getUniqueId())).isTrue();
    assertThat(keeper.recover(alice, false)).isEqualTo(SnapshotKeeper.Outcome.RESTORED);
    assertThat(alice.getInventory().getItem(0)).isEqualTo(new ItemStack(Material.DIAMOND_SWORD));
    assertThat(keeper.respawned(alice.getUniqueId())).isFalse();
  }

  @Test
  void aSnapshotLeftByACrashIsReplayedOnLoginWithoutItsMarker() {
    var bob = server.addPlayer("Bob");
    var left =
        new Snapshot(
            bob.getUniqueId(),
            "match-0",
            new Position("world", 1.5, 64, -2.5, 90, 10),
            new Vitals(new Vitals.Condition(17.5, 18, 2.5f, 0.5f), "SURVIVAL"),
            new Experience(12, 0.25f, 300),
            ItemData.of(ItemStack.serializeItemsAsBytes(List.of(new ItemStack(Material.BREAD, 3)))),
            List.of(),
            T0);
    store.rows.put(bob.getUniqueId(), left);
    var restartedMain = new ManualScheduler();
    var restarted = keeper(restartedMain, saved);
    restarted.load(() -> {});
    restartedMain.settle();

    bob.setAllowFlight(true);
    bob.setFlying(true);
    bob.setMaximumNoDamageTicks(0);
    assertThat(restarted.recover(bob, true)).isEqualTo(SnapshotKeeper.Outcome.RESTORED);

    assertThat(bob.getInventory().getItem(0)).isEqualTo(new ItemStack(Material.BREAD, 3));
    assertThat(bob.getLevel()).isEqualTo(12);
    assertThat(bob.getAllowFlight()).isFalse();
    assertThat(bob.isFlying()).isFalse();
    assertThat(bob.getMaximumNoDamageTicks()).isEqualTo(20);
    assertThat(marker.matches(bob, left)).isTrue();
    assertThat(restarted.restoring(bob.getUniqueId())).isFalse();
    restartedMain.settle();
    assertThat(store.rows).doesNotContainKey(bob.getUniqueId());
  }

  @Test
  void nobodyHasAnythingToRestoreUntilTheStoreIsRead() {
    var unloaded = keeper(new ManualScheduler(), saved);

    assertThat(unloaded.refusal(UUID.randomUUID())).contains(SnapshotBook.Refusal.NOT_LOADED);
    assertThat(unloaded.recover(alice(), true)).isEqualTo(SnapshotKeeper.Outcome.NOTHING);
  }

  @Test
  void anAppliedHistoricalMarkerRetiresTheRowWithoutReplayingBelongings() {
    var alice = alice();
    var capture = PlayerStates.capture(alice, "rwf", T0);
    var legacy =
        new Snapshot(
            capture.player(),
            capture.scope(),
            capture.position(),
            new Vitals(new Vitals.Condition(20, 20, 5, 0), "SURVIVAL"),
            capture.experience(),
            capture.inventory(),
            capture.effects(),
            capture.takenAt());
    store.rows.put(alice.getUniqueId(), legacy);
    marker.record(alice, legacy);
    // Inventory legitimately changed after the historical restore reached disk.
    alice.getInventory().setItem(0, new ItemStack(Material.DIAMOND_SWORD, 2));
    var _ = saved.save(alice);
    saved.load(alice);
    var restartedMain = new ManualScheduler();
    var restarted = keeper(restartedMain, saved);
    restarted.load(() -> {});
    restartedMain.settle();

    assertThat(restarted.recover(alice, true)).isEqualTo(SnapshotKeeper.Outcome.RESTORED);
    restartedMain.settle();
    assertThat(swords(alice)).isEqualTo(2);
    assertThat(store.rows).doesNotContainKey(alice.getUniqueId());
  }

  /** The steps of a restore after which the server can die. */
  enum CrashPoint {
    /** Belongings and marker applied in memory; the save never reached disk. */
    AFTER_APPLY,
    /** The file holds the restore; the read-back never finished. */
    AFTER_SAVE,
    /** The read-back proved the restore; the database never marked the row. */
    AFTER_READ_BACK,
    /** The row is marked restored; it was never deleted. */
    AFTER_MARK,
  }

  @ParameterizedTest
  @EnumSource(CrashPoint.class)
  void aCrashAtAnyStepNeitherLosesNorDuplicatesBelongings(CrashPoint crash) {
    var alice = alice();
    alice.setAllowFlight(true);
    alice.setFlying(true);
    alice.setFlySpeed(0.25f);
    keeper.capture(alice, "match-1", ignored -> {});
    main.settle();
    alice.setMaximumNoDamageTicks(0);
    var _ = saved.save(alice);
    saved.saves = 0;
    switch (crash) {
      case AFTER_APPLY -> saved.dropWrites = true;
      case AFTER_SAVE -> saved.lagReads = true;
      case AFTER_READ_BACK -> store.holdMarks = true;
      case AFTER_MARK -> store.holdDeletes = true;
    }

    keeper.restore(alice);
    main.settle();
    assertThat(swords(alice)).isEqualTo(1);

    // The server dies: the old keeper and its callbacks are gone, and Alice logs in again with
    // whatever her saved file holds.
    saved.dropWrites = false;
    saved.lagReads = false;
    store.holdMarks = false;
    store.holdDeletes = false;
    saved.load(alice);
    var restartedMain = new ManualScheduler();
    var restarted = keeper(restartedMain, saved);
    restarted.load(() -> {});
    restartedMain.settle();
    restarted.recover(alice, true);
    restartedMain.runFor(ALL_RETRIES);

    assertThat(swords(alice)).isEqualTo(1);
    assertThat(alice.getLevel()).isEqualTo(7);
    assertThat(alice.getAllowFlight()).isTrue();
    assertThat(alice.isFlying()).isTrue();
    assertThat(alice.getFlySpeed()).isEqualTo(0.25f);
    assertThat(alice.getMaximumNoDamageTicks()).isEqualTo(20);
    assertThat(store.unrestored()).isEmpty();
    assertThat(restarted.refusal(alice.getUniqueId())).isEmpty();

    // And her next login (or the next restart) applies nothing again.
    var _ = saved.save(alice);
    saved.load(alice);
    var again = new ManualScheduler();
    var third = keeper(again, saved);
    third.load(() -> {});
    again.settle();
    assertThat(third.recover(alice, true)).isEqualTo(SnapshotKeeper.Outcome.NOTHING);
    assertThat(swords(alice)).isEqualTo(1);
  }

  /** Rows keyed by player, with the restored mark kept beside them. */
  private static final class MemoryStore implements SnapshotStore {

    final Map<UUID, Snapshot> rows = new HashMap<>();
    final Map<UUID, Instant> restoredAt = new HashMap<>();
    boolean failSaves;
    boolean holdMarks;
    boolean holdDeletes;

    @Override
    public CompletableFuture<Void> save(Snapshot snapshot) {
      if (failSaves) {
        return CompletableFuture.failedFuture(new IllegalStateException("disk full"));
      }
      rows.put(snapshot.player(), snapshot);
      restoredAt.remove(snapshot.player());
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletableFuture<Boolean> markRestored(UUID player, Instant at) {
      if (holdMarks) {
        return new CompletableFuture<>();
      }
      if (!rows.containsKey(player) || restoredAt.containsKey(player)) {
        return CompletableFuture.completedFuture(false);
      }
      restoredAt.put(player, at);
      return CompletableFuture.completedFuture(true);
    }

    @Override
    public CompletableFuture<Void> deleteRestored(UUID player) {
      if (holdDeletes) {
        return new CompletableFuture<>();
      }
      if (restoredAt.containsKey(player)) {
        rows.remove(player);
      }
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletableFuture<List<Snapshot>> loadAll() {
      return CompletableFuture.completedFuture(unrestored());
    }

    List<Snapshot> unrestored() {
      var unrestored = new ArrayList<Snapshot>();
      rows.forEach(
          (player, snapshot) -> {
            if (!restoredAt.containsKey(player)) {
              unrestored.add(snapshot);
            }
          });
      return unrestored;
    }
  }
}
