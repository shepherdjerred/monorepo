package com.shepherdjerred.thestorm.arena;

import static com.shepherdjerred.thestorm.arena.ArenaHarness.messages;
import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.arena.adapter.db.JooqLeaderboardStore;
import com.shepherdjerred.thestorm.arena.adapter.db.JooqSnapshotStore;
import com.shepherdjerred.thestorm.arena.app.ArenaPresence;
import com.shepherdjerred.thestorm.arena.app.ArenaRecords;
import com.shepherdjerred.thestorm.arena.app.store.LeaderboardStore;
import com.shepherdjerred.thestorm.arena.domain.snapshot.EffectRecord;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Experience;
import com.shepherdjerred.thestorm.arena.domain.snapshot.ItemData;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Position;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Snapshot;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Vitals;
import com.shepherdjerred.thestorm.arena.testing.Samples;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Container;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * The arena on MockBukkit: joining snapshots and clears a player, every way out restores them
 * exactly, kit items are tagged, and a crash's snapshot is restored on the next join.
 */
final class ArenaPaperTest {

  @TempDir Path directory;
  private @Nullable ArenaHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  /** Keeps {@code harness} for cleanup and returns it. */
  private ArenaHarness track(ArenaHarness harness) {
    running = harness;
    return harness;
  }

  private ArenaHarness harness() {
    return requireNonNull(running);
  }

  /** A player with belongings to lose: diamonds, a helmet, experience, a potion effect. */
  private PlayerMock loadedPlayer(String name) {
    var player = harness().server.addPlayer(name);
    player.teleport(new Location(harness().world, 50.5, 70, -20.5, 45, 10));
    player.getInventory().addItem(ItemStack.of(Material.DIAMOND, 5));
    player.getInventory().setItem(EquipmentSlot.HEAD, ItemStack.of(Material.IRON_HELMET));
    player.setLevel(7);
    player.setExp(0.5f);
    player.setTotalExperience(160);
    player.setHealth(13);
    player.setFoodLevel(15);
    player.addPotionEffect(new PotionEffect(PotionEffectType.SPEED, 1200, 1));
    return player;
  }

  private List<Snapshot> stored() {
    return new JooqSnapshotStore(harness().database).loadAll().join();
  }

  private ArenaPresence presence() {
    return harness().services.require(ArenaPresence.class);
  }

  private boolean inLobby(PlayerMock player) {
    return presence().arenaOf(player.getUniqueId()).isPresent() && player.getInventory().isEmpty();
  }

  /**
   * Runs {@code command} until the arena accepts the player: right after enable, the arena refuses
   * joins until the last run's snapshots are read back.
   */
  private void enter(PlayerMock player, String command) {
    harness()
        .until(
            () -> {
              player.performCommand(command);
              return presence().arenaOf(player.getUniqueId()).isPresent();
            });
  }

  private void assertRestored(PlayerMock player) {
    assertThat(player.getInventory().contains(Material.DIAMOND, 5)).isTrue();
    assertThat(player.getInventory().getHelmet()).isEqualTo(ItemStack.of(Material.IRON_HELMET));
    assertThat(player.getLevel()).isEqualTo(7);
    assertThat(player.getExp()).isEqualTo(0.5f);
    assertThat(player.getTotalExperience()).isEqualTo(160);
    assertThat(player.getHealth()).isEqualTo(13);
    assertThat(player.getFoodLevel()).isEqualTo(15);
    assertThat(player.getPotionEffect(PotionEffectType.SPEED)).isNotNull();
    assertThat(player.getLocation().getX()).isEqualTo(50.5);
    assertThat(player.getLocation().getZ()).isEqualTo(-20.5);
    assertThat(player.getGameMode()).isEqualTo(GameMode.SURVIVAL);
  }

  @Test
  void joiningStoresASnapshotThenClearsThePlayerIntoTheLobby() {
    var harness = track(ArenaHarness.start(directory));
    var alice = loadedPlayer("Alice");

    enter(alice, "arena join colosseum");
    harness.until(() -> inLobby(alice));

    assertThat(stored())
        .singleElement()
        .satisfies(s -> assertThat(s.player()).isEqualTo(alice.getUniqueId()));
    assertThat(alice.getLevel()).isZero();
    assertThat(alice.getActivePotionEffects()).isEmpty();
    assertThat(alice.getLocation().getX()).isEqualTo(1010.5);
    assertThat(alice.getLocation().getZ()).isEqualTo(1010.5);
    assertThat(messages(alice)).anyMatch(m -> m.contains("Alice entered The Colosseum"));
  }

  @Test
  void leavingRestoresEverythingExactly() {
    var harness = track(ArenaHarness.start(directory));
    var alice = loadedPlayer("Alice");
    enter(alice, "arena join colosseum");
    harness.until(() -> inLobby(alice));
    alice.performCommand("arena class knight");

    alice.performCommand("arena leave");

    assertRestored(alice);
    assertThat(presence().arenaOf(alice.getUniqueId())).isEmpty();
    harness.until(() -> stored().isEmpty());
  }

  @Test
  void disconnectingRestoresThePlayerBeforeTheServerSavesThem() {
    var harness = track(ArenaHarness.start(directory));
    var alice = loadedPlayer("Alice");
    enter(alice, "arena join colosseum");
    harness.until(() -> inLobby(alice));

    alice.disconnect();

    assertRestored(alice);
    assertThat(presence().arenaOf(alice.getUniqueId())).isEmpty();
  }

  @Test
  void kitItemsAreTaggedAndEquipped() {
    var harness = track(ArenaHarness.start(directory));
    var alice = loadedPlayer("Alice");
    enter(alice, "arena join colosseum");
    harness.until(() -> inLobby(alice));
    messages(alice);

    alice.performCommand("arena class knight");

    var sword = alice.getInventory().getItemInMainHand();
    assertThat(sword.getType()).isEqualTo(Material.DIAMOND_SWORD);
    var tag = new NamespacedKey("thestorm", "arena_item");
    assertThat(
            sword.getItemMeta().getPersistentDataContainer().has(tag, PersistentDataType.BOOLEAN))
        .isTrue();
    assertThat(sword.getItemMeta().isUnbreakable()).isTrue();
    assertThat(alice.getInventory().getItemInOffHand().getType()).isEqualTo(Material.SHIELD);
    assertThat(alice.getInventory().getHelmet()).isNotNull();
    assertThat(requireNonNull(alice.getInventory().getHelmet()).getType())
        .isEqualTo(Material.IRON_HELMET);
    assertThat(
            Arrays.stream(alice.getInventory().getContents())
                .filter(Objects::nonNull)
                .filter(i -> !i.isEmpty()))
        .allSatisfy(
            item ->
                assertThat(
                        item.getItemMeta()
                            .getPersistentDataContainer()
                            .has(tag, PersistentDataType.BOOLEAN))
                    .isTrue());
    assertThat(messages(alice)).anyMatch(m -> m.contains("You are a Knight"));
  }

  @Test
  void advancedClassesNeedTheirPermission() {
    var harness = track(ArenaHarness.start(directory));
    var alice = loadedPlayer("Alice");
    enter(alice, "arena join colosseum");
    harness.until(() -> inLobby(alice));
    messages(alice);

    alice.performCommand("arena class vanguard");
    assertThat(messages(alice)).anyMatch(m -> m.contains("not unlocked"));

    alice.addAttachment(
        harness.server.getPluginManager().getPlugin("TheStorm"),
        "thestorm.arena.class.vanguard",
        true);
    alice.performCommand("arena class vanguard");
    assertThat(alice.getInventory().getItemInMainHand().getType()).isEqualTo(Material.MACE);
  }

  @Test
  void aPlayerCannotBeInTwoArenasOrJoinTwice() {
    var harness = track(ArenaHarness.start(directory));
    var alice = loadedPlayer("Alice");
    enter(alice, "arena join colosseum");
    harness.until(() -> inLobby(alice));
    messages(alice);

    alice.performCommand("arena join colosseum");
    alice.performCommand("arena spec colosseum");
    alice.performCommand("arena join nowhere");

    assertThat(messages(alice))
        .anyMatch(m -> m.contains("already in colosseum"))
        .anyMatch(m -> m.contains("no arena called nowhere"));
    assertThat(stored()).hasSize(1);
  }

  @Test
  void anAdminStartSendsFightersInAndFillsTheLootChests() {
    var harness = track(ArenaHarness.start(directory));
    var alice = loadedPlayer("Alice");
    enter(alice, "arena join colosseum");
    harness.until(() -> inLobby(alice));
    alice.performCommand("arena class knight");

    harness.server.dispatchCommand(harness.server.getConsoleSender(), "arena start colosseum");

    assertThat(alice.getLocation().getX()).isEqualTo(1030.5);
    assertThat(alice.getLocation().getZ()).isEqualTo(1025.5);
    assertThat(harness.chunks.kept).isPositive();
    var chest = (Container) harness.world.getBlockAt(1002, 61, 1058).getState();
    assertThat(chest.getInventory().isEmpty()).isFalse();

    alice.performCommand("arena leave");

    assertRestored(alice);
    assertThat(
            ((Container) harness.world.getBlockAt(1002, 61, 1058).getState())
                .getInventory()
                .isEmpty())
        .isTrue();
    assertThat(harness.chunks.released).isEqualTo(harness.chunks.kept);
  }

  @Test
  void spectatorsWatchInSpectatorModeAndAreRestored() {
    var harness = track(ArenaHarness.start(directory));
    var dave = loadedPlayer("Dave");

    enter(dave, "arena spec colosseum");
    harness.until(() -> dave.getGameMode() == GameMode.SPECTATOR);

    assertThat(dave.getLocation().getY()).isEqualTo(80);
    dave.performCommand("arena leave");
    assertRestored(dave);
  }

  @Test
  void aSnapshotLeftByACrashIsRestoredWhenThePlayerReturns() {
    var harness = track(ArenaHarness.prepare(directory));
    var alice = harness.server.addPlayer("Alice");
    var belongings =
        new ItemStack[] {ItemStack.of(Material.EMERALD, 12), ItemStack.of(Material.BREAD, 3)};
    var snapshot =
        new Snapshot(
            alice.getUniqueId(),
            "colosseum",
            new Position("world", 5.5, 70, 5.5, 0, 0),
            new Vitals(9, 11, 1, 0, "SURVIVAL"),
            new Experience(3, 0.25f, 40),
            ItemData.of(ItemStack.serializeItemsAsBytes(belongings)),
            List.of(new EffectRecord("minecraft:haste", 0, 400, false, true, true)),
            Samples.T0);
    new JooqSnapshotStore(harness.database).save(snapshot).join();
    alice.getInventory().addItem(ItemStack.of(Material.DIAMOND_SWORD));

    harness.enable(directory);
    harness.until(() -> alice.getInventory().contains(Material.EMERALD, 12));

    assertThat(alice.getInventory().contains(Material.DIAMOND_SWORD)).isFalse();
    assertThat(alice.getInventory().contains(Material.BREAD, 3)).isTrue();
    assertThat(alice.getLevel()).isEqualTo(3);
    assertThat(alice.getHealth()).isEqualTo(9);
    assertThat(alice.getPotionEffect(PotionEffectType.HASTE)).isNotNull();
    assertThat(alice.getLocation().getX()).isEqualTo(5.5);
    harness.until(() -> stored().isEmpty());
  }

  @Test
  void anAdminStopRestoresEveryoneInside() {
    var harness = track(ArenaHarness.start(directory));
    var alice = loadedPlayer("Alice");
    enter(alice, "arena join colosseum");
    harness.until(() -> inLobby(alice));

    harness.server.dispatchCommand(harness.server.getConsoleSender(), "arena stop colosseum");

    assertRestored(alice);
    assertThat(presence().arenaOf(alice.getUniqueId())).isEmpty();
  }

  @Test
  void theLeaderboardAndRecordsPortsReadBestWaves() {
    var harness = track(ArenaHarness.start(directory));
    var alice = harness.server.addPlayer("Alice");
    new JooqLeaderboardStore(harness.database)
        .record(
            new LeaderboardStore.Result(alice.getUniqueId(), "Alice", "colosseum", 42, Samples.T0))
        .join();
    messages(alice);

    alice.performCommand("arena top colosseum");
    harness.until(() -> messages(alice).stream().anyMatch(m -> m.contains("Alice - wave 42")));

    assertThat(
            harness
                .services
                .require(ArenaRecords.class)
                .bestWave(alice.getUniqueId(), "colosseum")
                .join())
        .hasValue(42);
  }

  @Test
  void membersCannotChangeTheArenasBlocks() {
    var harness = track(ArenaHarness.start(directory));
    var alice = loadedPlayer("Alice");
    enter(alice, "arena join colosseum");
    harness.until(() -> inLobby(alice));
    var floor = harness.world.getBlockAt(1020, 63, 1020);
    floor.setType(Material.STONE);
    var above = harness.world.getBlockAt(1020, 64, 1020);

    var broken = new BlockBreakEvent(floor, alice);
    harness.server.getPluginManager().callEvent(broken);
    var placed =
        new BlockPlaceEvent(
            above,
            above.getState(),
            floor,
            ItemStack.of(Material.DIRT),
            alice,
            true,
            EquipmentSlot.HAND);
    harness.server.getPluginManager().callEvent(placed);

    assertThat(broken.isCancelled()).isTrue();
    assertThat(placed.isCancelled()).isTrue();
  }

  @Test
  void outsidersMayBuildNearAnIdleArena() {
    var harness = track(ArenaHarness.start(directory));
    var bob = harness.server.addPlayer("Bob");
    var block = harness.world.getBlockAt(1020, 63, 1020);
    block.setType(Material.STONE);

    var broken = new BlockBreakEvent(block, bob);
    harness.server.getPluginManager().callEvent(broken);

    assertThat(broken.isCancelled()).isFalse();
  }
}
