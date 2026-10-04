package com.shepherdjerred.thestorm.core.snapshot;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.Plugin;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** The lifted lifecycle on MockBukkit, over an in-memory store and a game's own marker key. */
final class SnapshotKeeperTest {

  private static final Instant T0 = Instant.parse("2026-09-25T12:00:00Z");

  private final MemoryStore store = new MemoryStore();
  private ServerMock server;
  private Plugin plugin;
  private RestoreMarker marker;
  private SnapshotKeeper keeper;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    server.addSimpleWorld("world");
    plugin = MockBukkit.createMockPlugin("TheStorm");
    marker = new RestoreMarker(plugin, "match_restored_snapshot");
    keeper =
        new SnapshotKeeper(
            new SnapshotKeeper.Parts(
                plugin, new PaperScheduler(plugin), InstantSource.fixed(T0), store, marker));
    keeper.load(() -> {});
    settle();
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private void settle() {
    server.getScheduler().performTicks(5);
  }

  private PlayerMock alice() {
    var alice = server.addPlayer("Alice");
    alice.setGameMode(GameMode.SURVIVAL);
    alice.getInventory().setItem(0, new ItemStack(Material.DIAMOND_SWORD));
    alice.setLevel(7);
    return alice;
  }

  @Test
  void capturingEmptiesThePlayerAndStoresTheSnapshotUntilProofOfRestore() {
    var alice = alice();
    var stored = new AtomicReference<@Nullable Boolean>();

    keeper.capture(alice, "match-1", stored::set);

    assertThat(alice.getInventory().isEmpty()).isTrue();
    assertThat(alice.getLevel()).isZero();
    assertThat(keeper.holds(alice.getUniqueId())).isTrue();
    assertThat(keeper.refusal(alice.getUniqueId())).contains(SnapshotBook.Refusal.RESTORE_PENDING);
    settle();
    assertThat(stored.get()).isTrue();
    var row = Objects.requireNonNull(store.rows.get(alice.getUniqueId()));
    assertThat(row.scope()).isEqualTo("match-1");

    assertThat(keeper.restore(alice)).isEqualTo(SnapshotKeeper.Outcome.RESTORED);

    assertThat(alice.getInventory().getItem(0)).isEqualTo(new ItemStack(Material.DIAMOND_SWORD));
    assertThat(alice.getLevel()).isEqualTo(7);
    assertThat(marker.matches(alice, row)).isTrue();
    assertThat(keeper.holds(alice.getUniqueId())).isFalse();
    assertThat(keeper.refusal(alice.getUniqueId())).contains(SnapshotBook.Refusal.CLEANUP_PENDING);
    assertThat(store.restoredAt).doesNotContainKey(alice.getUniqueId());

    // A fresh login carrying the marker proves the restore reached disk: the row is retired.
    assertThat(keeper.recover(alice, true)).isEqualTo(SnapshotKeeper.Outcome.PROOF_PENDING);
    settle();
    assertThat(store.restoredAt).containsEntry(alice.getUniqueId(), T0);
    assertThat(store.rows).doesNotContainKey(alice.getUniqueId());
    assertThat(keeper.refusal(alice.getUniqueId())).isEmpty();
  }

  @Test
  void aFailedStorePutsThePlayerBackFromMemory() {
    var alice = alice();
    store.failSaves = true;
    var stored = new AtomicReference<@Nullable Boolean>();

    keeper.capture(alice, "match-1", stored::set);
    assertThat(alice.getInventory().isEmpty()).isTrue();
    settle();

    assertThat(stored.get()).isFalse();
    assertThat(alice.getInventory().getItem(0)).isEqualTo(new ItemStack(Material.DIAMOND_SWORD));
    assertThat(keeper.holds(alice.getUniqueId())).isFalse();
    assertThat(keeper.refusal(alice.getUniqueId())).isEmpty();
  }

  @Test
  void aDeadPlayerIsRestoredOnceTheyRespawn() {
    var alice = alice();
    keeper.capture(alice, "match-1", ignored -> {});
    settle();
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
            new Vitals(17.5, 18, 2.5f, 0.5f, "SURVIVAL"),
            new Experience(12, 0.25f, 300),
            ItemData.of(ItemStack.serializeItemsAsBytes(List.of(new ItemStack(Material.BREAD, 3)))),
            List.of(),
            T0);
    store.rows.put(bob.getUniqueId(), left);
    var restarted =
        new SnapshotKeeper(
            new SnapshotKeeper.Parts(
                plugin, new PaperScheduler(plugin), InstantSource.fixed(T0), store, marker));
    restarted.load(() -> {});
    settle();

    assertThat(restarted.recover(bob, true)).isEqualTo(SnapshotKeeper.Outcome.RESTORED);

    assertThat(bob.getInventory().getItem(0)).isEqualTo(new ItemStack(Material.BREAD, 3));
    assertThat(bob.getLevel()).isEqualTo(12);
    assertThat(marker.matches(bob, left)).isTrue();
    assertThat(keeper.restoring(bob.getUniqueId())).isFalse();
  }

  @Test
  void nobodyHasAnythingToRestoreUntilTheStoreIsRead() {
    var unloaded =
        new SnapshotKeeper(
            new SnapshotKeeper.Parts(
                plugin, new PaperScheduler(plugin), InstantSource.fixed(T0), store, marker));

    assertThat(unloaded.refusal(UUID.randomUUID())).contains(SnapshotBook.Refusal.NOT_LOADED);
    assertThat(unloaded.recover(alice(), true)).isEqualTo(SnapshotKeeper.Outcome.NOTHING);
  }

  /** Rows keyed by player, with the restored mark kept beside them. */
  private static final class MemoryStore implements SnapshotStore {

    final Map<UUID, Snapshot> rows = new HashMap<>();
    final Map<UUID, Instant> restoredAt = new HashMap<>();
    boolean failSaves;

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
      if (!rows.containsKey(player) || restoredAt.containsKey(player)) {
        return CompletableFuture.completedFuture(false);
      }
      restoredAt.put(player, at);
      return CompletableFuture.completedFuture(true);
    }

    @Override
    public CompletableFuture<Void> deleteRestored(UUID player) {
      if (restoredAt.containsKey(player)) {
        rows.remove(player);
      }
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletableFuture<List<Snapshot>> loadAll() {
      var unrestored = new ArrayList<Snapshot>();
      rows.forEach(
          (player, snapshot) -> {
            if (!restoredAt.containsKey(player)) {
              unrestored.add(snapshot);
            }
          });
      return CompletableFuture.completedFuture(unrestored);
    }
  }
}
