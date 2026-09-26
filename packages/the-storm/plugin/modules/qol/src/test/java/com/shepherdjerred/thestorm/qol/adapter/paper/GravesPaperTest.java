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
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.Creeper;
import org.bukkit.entity.Item;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.world.ChunkLoadEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
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

  /** Alice, carrying a sword, a stack of dirt and a helmet, dies at 0, 5, 0. */
  PlayerMock aliceDies() {
    var alice = harness.playerAt("Alice", 0, 0);
    alice.getInventory().setItem(0, new ItemStack(Material.DIAMOND_SWORD));
    alice.getInventory().setItem(5, new ItemStack(Material.DIRT, 64));
    alice.getInventory().setHelmet(new ItemStack(Material.IRON_HELMET));
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

  @Test
  void aDeathLeavesAGraveHoldingTheDropsWithTheirSlots() {
    var alice = aliceDies();

    assertThat(GraveBlocks.idAt(graveBlock())).isPresent();
    var saved = harness.store.loadAll().join();
    assertThat(saved).singleElement().satisfies(this::holdsAlicesKit);
    assertThat(harness.awaitMessage(alice, "Your items are in a grave at 0, 5, 0 in world"))
        .isNotEmpty();
    assertThat(alice.getInventory().isEmpty()).isTrue();
  }

  void holdsAlicesKit(GraveContents contents) {
    assertThat(contents.grave().ownerName()).isEqualTo("Alice");
    assertThat(contents.grave().pos()).isEqualTo(new GravePos("world", 0, 5, 0));
    assertThat(contents.items())
        .extracting(GraveItem::slot)
        .containsExactlyInAnyOrder(OptionalInt.of(0), OptionalInt.of(5), OptionalInt.of(39));
  }

  @Test
  void anEmptyInventoryLeavesNoGrave() {
    var bob = harness.playerAt("Bob", 3, 3);
    bob.setHealth(0);
    harness.server.getScheduler().performTicks(5);

    assertThat(harness.graves.all()).isEmpty();
  }

  @Test
  void theOwnerGetsEverythingBackIntoTheSameSlots() {
    var alice = aliceDies();
    alice.respawn();

    rightClick(alice, graveBlock());
    harness.until(() -> harness.graves.all().isEmpty());

    var inventory = alice.getInventory();
    assertThat(inventory.getItem(0)).isEqualTo(new ItemStack(Material.DIAMOND_SWORD));
    assertThat(inventory.getItem(5)).isEqualTo(new ItemStack(Material.DIRT, 64));
    assertThat(inventory.getHelmet()).isEqualTo(new ItemStack(Material.IRON_HELMET));
    assertThat(graveBlock().getType()).isEqualTo(Material.AIR);
    assertThat(harness.store.loadAll().join()).isEmpty();
  }

  @Test
  void strangersAreLockedOutUntilTheLockEnds() {
    aliceDies();
    var bob = harness.playerAt("Bob", 2, 0);

    rightClick(bob, graveBlock());

    assertThat(QolHarness.messages(bob))
        .anySatisfy(m -> assertThat(m).contains("Alice's grave. It opens to everyone in 15m"));
    assertThat(harness.graves.all())
        .singleElement()
        .satisfies(c -> assertThat(c.items()).hasSize(3));
  }

  @Test
  void afterTheLockAStrangerTakesOnlyWhatFits() {
    aliceDies();
    var bob = harness.playerAt("Bob", 2, 0);
    for (var slot = 1; slot < 36; slot++) {
      bob.getInventory().setItem(slot, new ItemStack(Material.STONE, 64));
    }
    harness.clock.advance(Duration.ofMinutes(15));

    rightClick(bob, graveBlock());
    harness.awaitMessage(bob, "2 are left");

    assertThat(bob.getInventory().getItem(0)).isNotNull();
    assertThat(harness.graves.all())
        .singleElement()
        .satisfies(c -> assertThat(c.items()).hasSize(2));
    assertThat(harness.store.loadAll().join())
        .singleElement()
        .satisfies(c -> assertThat(c.items()).hasSize(2));

    rightClick(bob, graveBlock());
    assertThat(QolHarness.messages(bob)).contains("[Graves]: Your inventory is full.");
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
  void aGraveWhoseBlockWasLostGetsItBackWhenItsChunkLoads() {
    var id = new UUID(0, 7);
    var owner = new UUID(0, 8);
    var grave =
        new GraveContents(
            new Grave(id, owner, "Carol", new GravePos("world", 4, 5, 4), harness.clock.instant()),
            List.of(
                new GraveItem(
                    0, OptionalInt.empty(), ItemCodec.encode(new ItemStack(Material.APPLE, 3)))));
    harness.store.create(grave).join();
    harness.close();

    harness = QolHarness.start(directory);
    assertThat(GraveBlocks.idAt(harness.world.getBlockAt(4, 5, 4))).isEmpty();
    harness.world.loadChunk(0, 0);
    harness
        .server
        .getPluginManager()
        .callEvent(new ChunkLoadEvent(harness.world.getChunkAt(0, 0), false));

    assertThat(GraveBlocks.idAt(harness.world.getBlockAt(4, 5, 4))).contains(id);
    assertThat(harness.graves.get(id)).contains(grave);
  }

  @Test
  void anExpiredGraveBreaksOpenAndDropsWhatIsLeft() {
    aliceDies();
    harness.clock.advance(Duration.ofDays(3));
    harness.world.loadChunk(0, 0);

    harness.server.getScheduler().performTicks(30 * 20 + 1);
    harness.until(() -> harness.graves.all().isEmpty());

    assertThat(graveBlock().getType()).isEqualTo(Material.AIR);
    assertThat(harness.world.getEntitiesByClass(Item.class)).hasSize(3);
    assertThat(harness.store.loadAll().join()).isEmpty();
  }

  @Test
  void gravesListsYourGravesWithCoordinates() {
    var alice = aliceDies();
    alice.respawn();
    QolHarness.messages(alice);

    alice.performCommand("graves");

    assertThat(QolHarness.messages(alice))
        .contains(
            "[Graves]: Your graves:",
            "[Graves]: 1. 0, 5, 0 in world: only you can open it for 15m");
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
            "[Graves]: Alice's grave holds 3 stacks: only Alice can open it for 15m. Right-click"
                + " to open it.");
  }
}
