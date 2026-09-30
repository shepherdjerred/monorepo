package com.shepherdjerred.thestorm.qol.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.qol.domain.grave.Grave;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveContents;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveItem;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePos;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.OptionalInt;
import java.util.UUID;
import org.bukkit.ExplosionResult;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.Creeper;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.world.ChunkLoadEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

final class GravesPaperTest {

  @TempDir Path directory;
  QolHarness harness;

  @BeforeEach
  void start() {
    harness = QolHarness.start(directory);
  }

  @AfterEach
  void stop() {
    harness.close();
  }

  Block graveBlock() {
    return harness.world.getBlockAt(0, 5, 0);
  }

  /** Alice, carrying a sword, a stack of dirt and a helmet, at 0, 5, 0. */
  PlayerMock aliceWithKit() {
    var alice = harness.playerAt("Alice", 0, 0);
    alice.getInventory().setItem(0, new ItemStack(Material.DIAMOND_SWORD));
    alice.getInventory().setItem(5, new ItemStack(Material.DIRT, 64));
    alice.getInventory().setHelmet(new ItemStack(Material.IRON_HELMET));
    return alice;
  }

  /** Alice dies with her kit and her grave is saved. */
  PlayerMock aliceDies() {
    var alice = aliceWithKit();
    alice.setHealth(0);
    harness.until(() -> harness.graves.ownedBy(alice.getUniqueId()).size() == 1);
    return alice;
  }

  void rightClick(PlayerMock player, Block block) {
    harness
        .server
        .getPluginManager()
        .callEvent(
            new PlayerInteractEvent(
                player, Action.RIGHT_CLICK_BLOCK, null, block, BlockFace.UP, EquipmentSlot.HAND));
  }

  static ItemStack arenaItem(Material type) {
    var stack = new ItemStack(type);
    var meta = stack.getItemMeta();
    meta.getPersistentDataContainer()
        .set(new NamespacedKey("thestorm", "arena_item"), PersistentDataType.BOOLEAN, true);
    stack.setItemMeta(meta);
    return stack;
  }

  /** The stacks in every saved grave, in storage. */
  int storedStacks() {
    return harness.store.loadAll().join().stream().mapToInt(c -> c.items().size()).sum();
  }

  @Test
  void aDeathLeavesAGraveHoldingTheDropsWithTheirSlots() {
    var alice = aliceDies();

    assertThat(GraveBlocks.idAt(graveBlock())).isPresent();
    var saved = harness.store.loadAll().join();
    assertThat(saved).singleElement().satisfies(this::holdsAlicesKit);
    assertThat(harness.awaitMessage(alice, "Your items are in a grave at 0, 5, 0 in world"))
        .isNotEmpty();
    assertThat(alice.getInventory().isEmpty()).isTrue();
    assertThat(harness.saved).contains(alice.getUniqueId());
  }

  void holdsAlicesKit(GraveContents contents) {
    assertThat(contents.grave().ownerName()).isEqualTo("Alice");
    assertThat(contents.grave().pos()).isEqualTo(new GravePos("world", 0, 5, 0));
    assertThat(contents.grave().replaced()).isEqualTo("minecraft:air");
    assertThat(contents.items())
        .extracting(GraveItem::slot)
        .containsExactlyInAnyOrder(OptionalInt.of(0), OptionalInt.of(5), OptionalInt.of(39));
  }

  /** Records what drops a death ends with, after every listener. */
  static final class DropSpy implements org.bukkit.event.Listener {
    final List<ItemStack> drops = new ArrayList<>();

    @org.bukkit.event.EventHandler(priority = org.bukkit.event.EventPriority.MONITOR)
    void onDeath(PlayerDeathEvent event) {
      drops.addAll(event.getDrops().stream().filter(s -> s != null && !s.isEmpty()).toList());
    }
  }

  DropSpy spyOnDrops() {
    var spy = new DropSpy();
    harness
        .server
        .getPluginManager()
        .registerEvents(spy, org.mockbukkit.mockbukkit.MockBukkit.createMockPlugin());
    return spy;
  }

  @Test
  void buriedItemsLeaveTheDropList() {
    var spy = spyOnDrops();
    aliceDies();
    assertThat(spy.drops).isEmpty();
  }

  @Test
  void anEmptyInventoryLeavesNoGrave() {
    var bob = harness.playerAt("Bob", 3, 3);
    bob.setHealth(0);
    harness.server.getScheduler().performTicks(5);

    assertThat(harness.graves.all()).isEmpty();
  }

  @Test
  void arenaItemsNeverGoIntoAGrave() {
    var spy = spyOnDrops();
    var bob = harness.playerAt("Bob", 3, 3);
    bob.getInventory().setItem(0, arenaItem(Material.IRON_SWORD));
    bob.getInventory().setItem(1, new ItemStack(Material.DIRT, 5));

    bob.setHealth(0);
    harness.until(() -> harness.graves.ownedBy(bob.getUniqueId()).size() == 1);

    assertThat(harness.graves.all())
        .singleElement()
        .satisfies(c -> assertThat(c.items()).hasSize(1));
    assertThat(spy.drops)
        .singleElement()
        .satisfies(s -> assertThat(ArenaTags.isArenaItem(s)).isTrue());
  }

  @Test
  void aDeathCarryingOnlyArenaItemsLeavesNoGrave() {
    var spy = spyOnDrops();
    var bob = harness.playerAt("Bob", 3, 3);
    bob.getInventory().setItem(0, arenaItem(Material.IRON_SWORD));

    bob.setHealth(0);
    harness.server.getScheduler().performTicks(5);

    assertThat(harness.graves.all()).isEmpty();
    assertThat(harness.world.getBlockAt(3, 5, 3).getType()).isEqualTo(Material.AIR);
    assertThat(spy.drops).hasSize(1);
  }

  @Test
  void theOwnerGetsEverythingBackIntoTheSameSlots() {
    var alice = aliceDies();
    alice.respawn();
    harness.saved.clear();

    rightClick(alice, graveBlock());
    harness.until(() -> harness.graves.all().isEmpty());

    var inventory = alice.getInventory();
    assertThat(inventory.getItem(0)).isEqualTo(new ItemStack(Material.DIAMOND_SWORD));
    assertThat(inventory.getItem(5)).isEqualTo(new ItemStack(Material.DIRT, 64));
    assertThat(inventory.getHelmet()).isEqualTo(new ItemStack(Material.IRON_HELMET));
    assertThat(graveBlock().getType()).isEqualTo(Material.AIR);
    assertThat(harness.store.loadAll().join()).isEmpty();
    assertThat(harness.saved).contains(alice.getUniqueId());
  }

  @Test
  void strangersAreLockedOutUntilTheLockEnds() {
    aliceDies();
    var bob = harness.playerAt("Bob", 2, 0);

    rightClick(bob, graveBlock());

    assertThat(QolHarness.messages(bob))
        .anySatisfy(m -> assertThat(m).contains("Alice's grave. It opens to everyone in 2h"));
    assertThat(harness.graves.all())
        .singleElement()
        .satisfies(c -> assertThat(c.items()).hasSize(3));
  }

  @Test
  void anOperatorWithoutTheNodeIsLockedOutToo() {
    aliceDies();
    var op = harness.playerAt("Op", 2, 0);
    op.setOp(true);

    assertThat(op.hasPermission(QolPermissions.GRAVES_ADMIN)).isFalse();
    rightClick(op, graveBlock());

    assertThat(QolHarness.messages(op))
        .anySatisfy(m -> assertThat(m).contains("opens to everyone"));
    assertThat(op.hasPermission(QolPermissions.GRAVES)).isTrue();
    assertThat(op.hasPermission(QolPermissions.SORT)).isTrue();
  }

  @Test
  void afterTheLockAStrangerTakesOnlyWhatFits() {
    aliceDies();
    var bob = harness.playerAt("Bob", 2, 0);
    for (var slot = 1; slot < 36; slot++) {
      bob.getInventory().setItem(slot, new ItemStack(Material.STONE, 64));
    }
    harness.clock.advance(Duration.ofHours(2));

    harness.until(
        () -> {
          rightClick(bob, graveBlock());
          return QolHarness.messages(bob).stream()
              .anyMatch(message -> message.contains("2 are left"));
        });

    assertThat(bob.getInventory().getItem(0)).isNotNull();
    assertThat(harness.graves.all())
        .singleElement()
        .satisfies(c -> assertThat(c.items()).hasSize(2));
    assertThat(storedStacks()).isEqualTo(2);

    rightClick(bob, graveBlock());
    assertThat(QolHarness.messages(bob)).contains("[Graves]: Your inventory is full.");
  }

  @Test
  void clickingAGraveBeingSavedLeavesItsHead() {
    var alice = aliceWithKit();
    var bob = harness.playerAt("Bob", 2, 0);
    alice.setHealth(0);

    rightClick(bob, graveBlock());

    assertThat(QolHarness.messages(bob))
        .contains("[Graves]: This grave is still being dug; try again in a moment.");
    assertThat(GraveBlocks.idAt(graveBlock())).isPresent();
    harness.until(() -> harness.graves.all().size() == 1);
    assertThat(GraveBlocks.idAt(graveBlock())).isPresent();
  }

  @Test
  void dyingAgainWhileTheFirstGraveIsSavingNeverDoublesItems() {
    var alice = aliceWithKit();
    alice.setHealth(0);
    alice.respawn();
    var drops = spyOnDrops();
    alice.getInventory().setItem(3, new ItemStack(Material.APPLE, 2));
    alice.setHealth(0);

    harness.until(() -> harness.graves.ownedBy(alice.getUniqueId()).size() == 1);

    assertThat(storedStacks()).isEqualTo(3);
    assertThat(drops.drops).containsExactly(new ItemStack(Material.APPLE, 2));
    assertThat(harness.graves.all()).extracting(c -> c.grave().pos()).doesNotHaveDuplicates();
    assertThat(alice.getInventory().isEmpty()).isTrue();
  }

  @Test
  void aFailedSaveKeepsTheDeathHandoffForRetry() {
    harness.store.failCreate = true;
    var alice = aliceWithKit();

    alice.setHealth(0);
    harness.awaitMessage(alice, "waiting for storage");
    harness.server.getScheduler().performTicks(5);

    var inventory = alice.getInventory();
    var total =
        java.util.Arrays.stream(inventory.getContents())
            .filter(s -> s != null && !s.isEmpty())
            .mapToInt(ItemStack::getAmount)
            .sum();
    assertThat(total).isZero();
    assertThat(GraveHandoff.death(alice)).isPresent();
    assertThat(harness.graves.all()).isEmpty();
    assertThat(GraveBlocks.idAt(graveBlock())).isPresent();
    assertThat(harness.store.loadAll().join()).isEmpty();
  }

  @Test
  void stoppingAfterTheHandoffCommitKeepsOneStoredCopy() {
    aliceWithKit().setHealth(0);
    harness.until(() -> harness.store.loadAll().join().size() == 1);

    harness.close();
    harness = QolHarness.start(directory);

    assertThat(harness.store.loadAll().join())
        .singleElement()
        .satisfies(c -> assertThat(c.items()).hasSize(3));
  }

  @Test
  void graveBlocksSurviveBreakingAndExplosions() {
    aliceDies();
    var bob = harness.playerAt("Bob", 2, 0);
    var next = harness.world.getBlockAt(1, 4, 0);

    var breaking = new BlockBreakEvent(graveBlock(), bob);
    harness.server.getPluginManager().callEvent(breaking);
    var creeper = harness.world.spawn(bob.getLocation(), Creeper.class);
    var blown = new ArrayList<>(List.of(graveBlock(), next));
    var explosion =
        new EntityExplodeEvent(creeper, bob.getLocation(), blown, 1f, ExplosionResult.DESTROY);
    harness.server.getPluginManager().callEvent(explosion);

    assertThat(breaking.isCancelled()).isTrue();
    assertThat(explosion.blockList()).containsExactly(next);
  }

  @Test
  void gravesGoOnlyWhereTheOwnerMayBuild() {
    harness.land.noBuilding = location -> location.getBlockX() <= 0;
    var alice = aliceWithKit();

    alice.setHealth(0);
    harness.until(() -> harness.graves.ownedBy(alice.getUniqueId()).size() == 1);

    var pos = harness.graves.all().getFirst().grave().pos();
    assertThat(pos).isEqualTo(new GravePos("world", 1, 5, 0));
    assertThat(graveBlock().getType()).isEqualTo(Material.AIR);
  }

  @Test
  void withNowhereToBuildTheGraveGoesWhereTheOwnerDied() {
    harness.land.noBuilding = location -> true;
    var alice = aliceWithKit();

    alice.setHealth(0);
    harness.until(() -> harness.graves.ownedBy(alice.getUniqueId()).size() == 1);

    assertThat(harness.graves.all().getFirst().grave().pos())
        .isEqualTo(new GravePos("world", 0, 5, 0));
  }

  @Test
  void gravesNeverReplaceWaterOrLight() {
    graveBlock().setType(Material.WATER);
    harness.world.getBlockAt(-1, 5, 0).setType(Material.LIGHT);
    var alice = aliceWithKit();

    alice.setHealth(0);
    harness.until(() -> harness.graves.ownedBy(alice.getUniqueId()).size() == 1);

    var pos = harness.graves.all().getFirst().grave().pos();
    assertThat(pos).isNotIn(new GravePos("world", 0, 5, 0), new GravePos("world", -1, 5, 0));
    assertThat(graveBlock().getType()).isEqualTo(Material.WATER);
    assertThat(harness.world.getBlockAt(-1, 5, 0).getType()).isEqualTo(Material.LIGHT);
  }

  @Test
  void aGraveWhoseBlockWasLostGetsItBackWhenItsChunkLoads() {
    var id = new UUID(0, 7);
    var owner = new UUID(0, 8);
    var grave =
        new GraveContents(
            new Grave(
                id,
                owner,
                "Carol",
                new GravePos("world", 4, 5, 4),
                harness.clock.instant(),
                "minecraft:air"),
            List.of(
                new GraveItem(
                    0, OptionalInt.empty(), ItemCodec.encode(new ItemStack(Material.APPLE, 3)))));
    harness.store.create(grave).join();
    harness.close();

    harness = QolHarness.start(directory);
    // Startup reconciles loaded chunks; a later chunk-load event is idempotent.
    assertThat(GraveBlocks.idAt(harness.world.getBlockAt(4, 5, 4))).contains(id);
    harness.world.loadChunk(0, 0);
    harness
        .server
        .getPluginManager()
        .callEvent(new ChunkLoadEvent(harness.world.getChunkAt(0, 0), false));

    assertThat(GraveBlocks.idAt(harness.world.getBlockAt(4, 5, 4))).contains(id);
    assertThat(harness.graves.get(id)).contains(grave);
  }

  @Test
  void anExpiredGraveBreaksOpenInItsOwnChunkAndTellsTheOwner() {
    var alice = aliceDies();
    harness.clock.advance(Duration.ofDays(7));

    harness
        .server
        .getPluginManager()
        .callEvent(new ChunkLoadEvent(harness.world.getChunkAt(0, 0), false));
    harness.until(() -> harness.store.pendingDrops().join().size() == 3);
    harness.until(() -> graveBlock().getType() == Material.AIR);
    harness.until(() -> harness.world.getEntitiesByClass(ItemDisplay.class).size() == 3);

    assertThat(graveBlock().getType()).isEqualTo(Material.AIR);
    assertThat(harness.world.getEntitiesByClass(ItemDisplay.class)).hasSize(3);
    assertThat(harness.store.loadAll().join())
        .singleElement()
        .satisfies(c -> assertThat(c.items()).isEmpty());
    assertThat(harness.awaitMessage(alice, "broke open after 7d")).isNotEmpty();
  }

  @Test
  void anOfflineOwnerHearsAboutTheirExpiredGraveWhenTheyJoin() {
    var alice = aliceDies();
    var id = alice.getUniqueId();
    alice.disconnect();
    harness.clock.advance(Duration.ofDays(7));

    harness
        .server
        .getPluginManager()
        .callEvent(new ChunkLoadEvent(harness.world.getChunkAt(0, 0), false));
    harness.until(() -> harness.store.pendingDrops().join().size() == 3);

    var back = new PlayerMock(harness.server, "Alice", id);
    harness.server.addPlayer(back);
    assertThat(harness.awaitMessage(back, "broke open after 7d")).isNotEmpty();
    assertThat(harness.store.listNotices(id).join()).isEmpty();
  }

  @Test
  void gravesListsYourGravesWithCoordinates() {
    var alice = aliceDies();
    alice.respawn();
    QolHarness.messages(alice);

    alice.performCommand("graves");

    assertThat(QolHarness.messages(alice))
        .contains(
            "[Graves]: Your graves:", "[Graves]: 1. 0, 5, 0 in world: only you can open it for 2h");
  }

  @Test
  void leftClickingAGraveDescribesIt() {
    aliceDies();
    var bob = harness.playerAt("Bob", 2, 0);

    harness
        .server
        .getPluginManager()
        .callEvent(
            new PlayerInteractEvent(
                bob,
                Action.LEFT_CLICK_BLOCK,
                null,
                graveBlock(),
                BlockFace.UP,
                EquipmentSlot.HAND));

    assertThat(QolHarness.messages(bob))
        .contains(
            "[Graves]: Alice's grave holds 3 stacks: only Alice can open it for 2h. Right-click"
                + " to open it.");
  }

  @Test
  void unreadableStorageStopsQol() {
    harness.close();
    harness = QolHarness.start(directory, true);

    harness.until(
        () ->
            PlayerDeathEvent.getHandlerList().getRegisteredListeners().length == 0
                && !harness.graves.isLoaded());
  }
}
