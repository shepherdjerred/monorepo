package com.shepherdjerred.thestorm.arena;

import static com.shepherdjerred.thestorm.arena.ArenaHarness.messages;
import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.arena.adapter.db.JooqRewardStore;
import com.shepherdjerred.thestorm.arena.adapter.db.JooqSnapshotStore;
import com.shepherdjerred.thestorm.arena.app.ArenaPresence;
import com.shepherdjerred.thestorm.arena.app.store.RewardStore;
import com.shepherdjerred.thestorm.arena.domain.snapshot.ItemData;
import com.shepherdjerred.thestorm.arena.testing.Samples;
import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.ExplosionResult;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Container;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Drowned;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Zombie;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.entity.EntityTransformEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * Items and players cannot leak into or out of an arena, restores survive crashes, and arena mobs
 * stay arena mobs (MockBukkit).
 */
final class ArenaSafetyTest {

  private static final NamespacedKey ITEM_TAG = new NamespacedKey("thestorm", "arena_item");
  private static final NamespacedKey ENTITY_TAG = new NamespacedKey("thestorm", "arena_entity");

  @TempDir Path directory;
  private @Nullable ArenaHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  private ArenaHarness start() {
    running = ArenaHarness.start(directory);
    return running;
  }

  private ArenaHarness harness() {
    return requireNonNull(running);
  }

  private ArenaPresence presence() {
    return harness().services.require(ArenaPresence.class);
  }

  private PlayerMock player(String name) {
    var player = harness().server.addPlayer(name);
    player.teleport(new Location(harness().world, 50.5, 70, -20.5));
    player.getInventory().addItem(ItemStack.of(Material.DIAMOND, 5));
    return player;
  }

  private static int diamonds(PlayerMock player) {
    return player.getInventory().all(Material.DIAMOND).values().stream()
        .mapToInt(ItemStack::getAmount)
        .sum();
  }

  /** Joins, returning as soon as the arena accepts the player (while they are still joining). */
  private void join(PlayerMock player, String command) {
    harness()
        .until(
            () -> {
              player.performCommand(command);
              return presence().arenaOf(player.getUniqueId()).isPresent();
            });
  }

  private boolean inLobby(PlayerMock player) {
    var at = player.getLocation();
    return presence().arenaOf(player.getUniqueId()).isPresent()
        && at.getX() == 1010.5
        && at.getZ() == 1010.5;
  }

  private void lobby(PlayerMock player) {
    join(player, "arena join colosseum");
    harness().until(() -> inLobby(player));
  }

  private void fight(PlayerMock player) {
    lobby(player);
    player.performCommand("arena class knight");
    harness().server.dispatchCommand(harness().server.getConsoleSender(), "arena start colosseum");
  }

  private static ItemStack tagged(Material material) {
    var stack = ItemStack.of(material);
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(ITEM_TAG, PersistentDataType.BOOLEAN, true));
    return stack;
  }

  private Location inside() {
    return new Location(harness().world, 1020.5, 64, 1020.5);
  }

  private Location outside() {
    return new Location(harness().world, 900.5, 64, 900.5);
  }

  private <T extends Event> T call(T event) {
    harness().server.getPluginManager().callEvent(event);
    return event;
  }

  // P0: the pending window.

  @Test
  void aJoiningPlayerIsEmptiedAtOnceSoNothingTheyDoWhileJoiningDuplicates() {
    var harness = start();
    var alice = player("Alice");

    join(alice, "arena join colosseum");

    assertThat(diamonds(alice)).as("emptied in the same tick").isZero();
    var loose = harness.world.dropItem(alice.getLocation(), ItemStack.of(Material.DIAMOND, 5));
    assertThat(call(new PlayerDropItemEvent(alice, loose)).isCancelled()).isTrue();
    assertThat(call(new EntityPickupItemEvent(alice, loose, 0)).isCancelled()).isTrue();
    var before = alice.getLocation();
    alice.teleport(outside());
    assertThat(alice.getLocation()).isEqualTo(before);
    loose.remove();

    harness.until(() -> inLobby(alice));
    alice.performCommand("arena leave");

    assertThat(diamonds(alice)).isEqualTo(5);
  }

  @Test
  void aSnapshotThatCannotBeStoredPutsThePlayerBackAtOnce() {
    var harness = start();
    var alice = player("Alice");
    // A first game proves the stored snapshots are loaded and cleans up after itself.
    lobby(alice);
    alice.performCommand("arena leave");
    harness.until(() -> new JooqSnapshotStore(harness.database).loadAll().join().isEmpty());
    harness
        .database
        .write(
            dsl -> {
              dsl.execute("DROP TABLE arena_snapshot_effects");
              return dsl.execute("DROP TABLE arena_snapshots");
            })
        .join();
    messages(alice);

    join(alice, "arena join colosseum");
    assertThat(diamonds(alice)).as("emptied while the write runs").isZero();

    var seen = new ArrayList<String>();
    harness.until(
        () -> {
          seen.addAll(messages(alice));
          return seen.stream().anyMatch(m -> m.contains("could not be saved"));
        });

    assertThat(presence().arenaOf(alice.getUniqueId())).isEmpty();
    assertThat(diamonds(alice)).isEqualTo(5);
    assertThat(alice.getLocation().getX()).isEqualTo(50.5);
  }

  // P1: kit items escaping, outsiders looting.

  @Test
  void membersOpenNoContainerButTheirOwnInventory() {
    var harness = start();
    var alice = player("Alice");
    lobby(alice);
    var block = harness.world.getBlockAt(1015, 64, 1015);
    block.setType(Material.CHEST);

    var chest = ((Container) block.getState()).getInventory();

    alice.openInventory(chest);

    assertThat(alice.getOpenInventory().getTopInventory()).isNotSameAs(chest);
  }

  @Test
  void membersLeaveEntitiesAndOutsideBlocksAlone() {
    var harness = start();
    var alice = player("Alice");
    lobby(alice);
    var stand = harness.world.spawn(inside(), ArmorStand.class);
    var far = harness.world.getBlockAt(900, 63, 900);
    far.setType(Material.CHEST);

    var entity = call(new PlayerInteractEntityEvent(alice, stand, EquipmentSlot.HAND));
    var reach =
        call(new PlayerInteractEvent(alice, Action.RIGHT_CLICK_BLOCK, null, far, BlockFace.UP));

    assertThat(entity.isCancelled()).isTrue();
    assertThat(reach.useInteractedBlock()).isEqualTo(Event.Result.DENY);
  }

  @Test
  void anOutsiderOpeningAnythingLosesArenaItemsFromItAndTheirInventory() {
    var harness = start();
    var bob = player("Bob");
    bob.getInventory().addItem(tagged(Material.DIAMOND_SWORD));
    var block = harness.world.getBlockAt(900, 64, 900);
    block.setType(Material.CHEST);
    var chest = ((Container) block.getState()).getInventory();
    chest.addItem(tagged(Material.SHIELD), ItemStack.of(Material.BREAD));

    bob.openInventory(chest);

    assertThat(bob.getInventory().contains(Material.DIAMOND_SWORD)).isFalse();
    assertThat(bob.getInventory().contains(Material.DIAMOND)).isTrue();
    assertThat(chest.contains(Material.SHIELD)).isFalse();
    assertThat(chest.contains(Material.BREAD)).isTrue();
  }

  @Test
  void anOutsiderPickingUpAnArenaItemDestroysIt() {
    var harness = start();
    var bob = player("Bob");
    var loose = harness.world.dropItem(outside(), tagged(Material.GOLDEN_APPLE));

    var pickup = call(new EntityPickupItemEvent(bob, loose, 0));

    assertThat(pickup.isCancelled()).isTrue();
    assertThat(loose.isValid()).isFalse();
  }

  @Test
  void outsidersCannotLootOrTeleportIntoARunningArenaAndAreSentOut() {
    var harness = start();
    var alice = player("Alice");
    fight(alice);
    var bob = player("Bob");

    var chest = ((Container) harness.world.getBlockAt(1002, 61, 1058).getState()).getInventory();
    bob.openInventory(chest);
    assertThat(bob.getOpenInventory().getTopInventory()).isNotSameAs(chest);
    var click =
        call(
            new PlayerInteractEvent(
                bob,
                Action.RIGHT_CLICK_BLOCK,
                null,
                harness.world.getBlockAt(1002, 61, 1058),
                BlockFace.UP));
    assertThat(click.useInteractedBlock()).isEqualTo(Event.Result.DENY);

    bob.teleport(inside());
    assertThat(bob.getLocation().getX()).isEqualTo(50.5);

    bob.setLocation(inside());
    harness.until(() -> bob.getLocation().getX() == 990.5);
    assertThat(presence().isGameRunningAt(inside())).isTrue();
    assertThat(presence().isGameRunningAt(outside())).isFalse();
  }

  // P1: the restore order.

  @Test
  void aRestoreSavesThePlayerBeforeDeletingTheirSnapshot() {
    var harness = start();
    var alice = player("Alice");
    lobby(alice);

    alice.performCommand("arena leave");

    assertThat(harness.saver.saves).containsExactly("Alice (snapshot stored)");
    harness.until(() -> new JooqSnapshotStore(harness.database).loadAll().join().isEmpty());
  }

  // P1: arena mobs stay arena mobs.

  @Test
  void arenaMobsNeverTransformButStillSplit() {
    var harness = start();
    var zombie = harness.world.spawn(inside(), Zombie.class);
    zombie.getPersistentDataContainer().set(ENTITY_TAG, PersistentDataType.STRING, "colosseum");
    var drowned = harness.world.spawn(inside(), Drowned.class);
    var stray = harness.world.spawn(outside(), Zombie.class);

    var drowning =
        call(
            new EntityTransformEvent(
                zombie, List.of(drowned), EntityTransformEvent.TransformReason.DROWNED));
    var splitting =
        call(
            new EntityTransformEvent(
                zombie, List.of(drowned), EntityTransformEvent.TransformReason.SPLIT));
    var wild =
        call(
            new EntityTransformEvent(
                stray, List.of(drowned), EntityTransformEvent.TransformReason.DROWNED));

    assertThat(drowning.isCancelled()).isTrue();
    assertThat(splitting.isCancelled()).isFalse();
    assertThat(wild.isCancelled()).isFalse();
  }

  @Test
  void offspringBornInARunningArenaJoinTheWave() {
    var harness = start();
    var alice = player("Alice");
    fight(alice);

    Entity reinforcement =
        harness.world.spawn(inside(), Zombie.class, z -> {}, SpawnReason.REINFORCEMENTS);
    Entity wild = harness.world.spawn(outside(), Zombie.class, z -> {}, SpawnReason.REINFORCEMENTS);

    assertThat(
            reinforcement.getPersistentDataContainer().get(ENTITY_TAG, PersistentDataType.STRING))
        .isEqualTo("colosseum");
    assertThat(wild.getPersistentDataContainer().has(ENTITY_TAG)).isFalse();
  }

  @Test
  void aRefusedMobSpawnStopsTheGameAndRestoresEveryone() {
    var harness = start();
    harness
        .server
        .getPluginManager()
        .registerEvents(
            new RefuseArenaSpawns(),
            requireNonNull(harness.server.getPluginManager().getPlugin("TheStorm")));
    var alice = player("Alice");
    fight(alice);
    messages(alice);

    harness.clock.advance(Duration.ofSeconds(6));
    harness.until(() -> presence().arenaOf(alice.getUniqueId()).isEmpty());

    assertThat(diamonds(alice)).isEqualTo(5);
    assertThat(messages(alice)).anyMatch(m -> m.contains("mobs could not spawn"));
  }

  /** Land protection gone wrong: every plugin spawn but a wolf is cancelled. */
  public static final class RefuseArenaSpawns implements Listener {
    @EventHandler
    public void refuse(CreatureSpawnEvent event) {
      if (event.getSpawnReason() == SpawnReason.CUSTOM
          && event.getEntityType() != EntityType.WOLF) {
        event.setCancelled(true);
      }
    }
  }

  // P2: grief, cursors, loot.

  @Test
  void membersPlaceNothingAnywhereAndArenaExplosionsBreakNothing() {
    var harness = start();
    var alice = player("Alice");
    lobby(alice);
    var against = harness.world.getBlockAt(900, 63, 900);
    against.setType(Material.STONE);
    var above = harness.world.getBlockAt(900, 64, 900);

    var placed =
        call(
            new BlockPlaceEvent(
                above,
                above.getState(),
                against,
                ItemStack.of(Material.DIRT),
                alice,
                true,
                EquipmentSlot.HAND));

    assertThat(placed.isCancelled()).isTrue();
    var bomber = harness.world.spawn(outside(), Zombie.class);
    bomber.getPersistentDataContainer().set(ENTITY_TAG, PersistentDataType.STRING, "colosseum");
    var blocks = new ArrayList<>(List.of(against, above));
    var blast = call(new EntityExplodeEvent(bomber, outside(), blocks, 1, ExplosionResult.DESTROY));
    assertThat(blast.blockList()).isEmpty();
  }

  @Test
  void theItemOnTheCursorIsPartOfTheSnapshot() {
    start();
    var alice = player("Alice");
    alice.setItemOnCursor(ItemStack.of(Material.EMERALD, 3));

    lobby(alice);
    assertThat(alice.getItemOnCursor().isEmpty()).isTrue();
    alice.performCommand("arena leave");

    assertThat(alice.getInventory().contains(Material.EMERALD, 3)).isTrue();
    assertThat(diamonds(alice)).isEqualTo(5);
  }

  @Test
  void vaultLootIsClaimedBeforeItIsHandedOutAndOnlyOnce() {
    var harness = ArenaHarness.prepare(directory);
    running = harness;
    var loot =
        ItemData.of(
            ItemStack.serializeItemsAsBytes(
                new ItemStack[] {ItemStack.of(Material.NETHERITE_INGOT, 2)}));
    var alice = harness.server.addPlayer("Alice");
    new JooqRewardStore(harness.database)
        .claimVault(
            new RewardStore.VaultClaim(
                alice.getUniqueId(), 70, LocalDate.of(2026, 9, 25), loot, Samples.T0))
        .join();

    harness.enable(directory);
    harness.until(() -> alice.getInventory().contains(Material.NETHERITE_INGOT, 2));
    alice.performCommand("arena list");
    harness.server.getScheduler().performTicks(40);

    assertThat(
            alice.getInventory().all(Material.NETHERITE_INGOT).values().stream()
                .mapToInt(ItemStack::getAmount)
                .sum())
        .isEqualTo(2);
    assertThat(new JooqRewardStore(harness.database).claimAll(alice.getUniqueId()).join())
        .isEmpty();
  }
}
