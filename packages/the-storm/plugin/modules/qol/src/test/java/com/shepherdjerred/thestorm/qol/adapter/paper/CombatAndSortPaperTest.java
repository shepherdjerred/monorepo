package com.shepherdjerred.thestorm.qol.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.time.Duration;
import java.util.Arrays;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerKickEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class CombatAndSortPaperTest {

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

  @Test
  void taggedPlayersCannotTeleportUntilTheTagEnds() {
    var alice = harness.playerAt("Alice", 0, 0);
    var bob = harness.playerAt("Bob", 2, 0);
    var home = alice.getLocation();

    harness.combat.hit(alice.getUniqueId(), bob.getUniqueId());

    var refusal = harness.guards.refusal(alice.getUniqueId(), home);
    assertThat(refusal)
        .map(PlainTextComponentSerializer.plainText()::serialize)
        .contains("[Combat]: You cannot teleport while in combat (15s left).");
    harness.clock.advance(Duration.ofSeconds(15));
    assertThat(harness.guards.refusal(alice.getUniqueId(), home)).isEmpty();
  }

  @Test
  void loggingOutInCombatKillsThePlayerAndTheirItemsGoToAGrave() {
    var alice = harness.playerAt("Alice", 0, 0);
    var bob = harness.playerAt("Bob", 2, 0);
    alice.getInventory().setItem(0, new ItemStack(Material.GOLDEN_APPLE, 3));
    harness.combat.hit(bob.getUniqueId(), alice.getUniqueId());

    alice.disconnect();

    assertThat(alice.isDead()).isTrue();
    assertThat(harness.awaitMessage(bob, "Alice logged out in combat and was struck down."))
        .isNotEmpty();
    harness.until(() -> harness.graves.ownedBy(alice.getUniqueId()).size() == 1);
    assertThat(harness.combat.inCombat(alice.getUniqueId())).isFalse();
  }

  @Test
  void loggingOutOutOfCombatIsHarmless() {
    var alice = harness.playerAt("Alice", 0, 0);

    alice.disconnect();

    assertThat(alice.isDead()).isFalse();
  }

  @Test
  void aPlayerStaffKickDuringCombatSurvives() {
    var alice = harness.playerAt("Alice", 0, 0);
    var bob = harness.playerAt("Bob", 2, 0);
    harness.combat.hit(bob.getUniqueId(), alice.getUniqueId());

    alice.kick(Component.text("Take a break"), PlayerKickEvent.Cause.PLUGIN);

    assertThat(alice.isDead()).isFalse();
  }

  static ItemStack named(Material type, int amount, String name) {
    var stack = new ItemStack(type, amount);
    var meta = stack.getItemMeta();
    meta.customName(Component.text(name));
    stack.setItemMeta(meta);
    return stack;
  }

  @Test
  void sortingOrdersByTypeThenNameAndMergesPartialStacks() {
    Inventory chest = harness.server.createInventory(null, 27);
    chest.setItem(0, new ItemStack(Material.STONE, 5));
    chest.setItem(3, new ItemStack(Material.DIRT, 10));
    chest.setItem(4, named(Material.DIAMOND_SWORD, 1, "Excalibur"));
    chest.setItem(7, new ItemStack(Material.DIRT, 60));
    chest.setItem(9, new ItemStack(Material.APPLE, 1));
    chest.setItem(26, new ItemStack(Material.DIAMOND_SWORD, 1));

    InventorySorter.sort(chest);

    assertThat(Arrays.asList(chest.getContents()).subList(0, 7))
        .containsExactly(
            new ItemStack(Material.APPLE, 1),
            new ItemStack(Material.DIAMOND_SWORD, 1),
            named(Material.DIAMOND_SWORD, 1, "Excalibur"),
            new ItemStack(Material.DIRT, 64),
            new ItemStack(Material.DIRT, 6),
            new ItemStack(Material.STONE, 5),
            null);
  }

  @Test
  void sortingAnEmptyInventoryDoesNothing() {
    Inventory chest = harness.server.createInventory(null, 9);
    InventorySorter.sort(chest);
    assertThat(chest.isEmpty()).isTrue();
  }

  @Test
  void aSneakingPunchSortsYourEnderChest() {
    var alice = harness.playerAt("Alice", 0, 0);
    var enderChest = harness.world.getBlockAt(1, 5, 0);
    enderChest.setType(Material.ENDER_CHEST);
    alice.getEnderChest().setItem(5, new ItemStack(Material.STONE, 1));
    alice.getEnderChest().setItem(8, new ItemStack(Material.APPLE, 1));
    alice.setSneaking(true);

    var punch =
        new PlayerInteractEvent(
            alice, Action.LEFT_CLICK_BLOCK, null, enderChest, BlockFace.UP, EquipmentSlot.HAND);
    harness.server.getPluginManager().callEvent(punch);

    assertThat(punch.useInteractedBlock()).isEqualTo(Event.Result.DENY);
    assertThat(alice.getEnderChest().getItem(0)).isEqualTo(new ItemStack(Material.APPLE, 1));
    assertThat(alice.getEnderChest().getItem(1)).isEqualTo(new ItemStack(Material.STONE, 1));
  }

  @Test
  void aPunchWithoutSneakingIsAPunch() {
    var alice = harness.playerAt("Alice", 0, 0);
    var enderChest = harness.world.getBlockAt(1, 5, 0);
    enderChest.setType(Material.ENDER_CHEST);
    alice.getEnderChest().setItem(5, new ItemStack(Material.STONE, 1));

    var punch =
        new PlayerInteractEvent(
            alice, Action.LEFT_CLICK_BLOCK, null, enderChest, BlockFace.UP, EquipmentSlot.HAND);
    harness.server.getPluginManager().callEvent(punch);

    assertThat(punch.useInteractedBlock()).isNotEqualTo(Event.Result.DENY);
    assertThat(alice.getEnderChest().getItem(5)).isEqualTo(new ItemStack(Material.STONE, 1));
  }

  @Test
  void protectedContainersAreNotSorted() {
    var alice = harness.playerAt("Alice", 0, 0);
    var enderChest = harness.world.getBlockAt(1, 5, 0);
    enderChest.setType(Material.ENDER_CHEST);
    alice.getEnderChest().setItem(5, new ItemStack(Material.STONE, 1));
    harness.land.containers = false;

    new ContainerSorting(harness.land).sort(alice, enderChest);

    assertThat(alice.getEnderChest().getItem(5)).isEqualTo(new ItemStack(Material.STONE, 1));
    assertThat(QolHarness.messages(alice)).contains("[Sort]: This land belongs to Aegis.");
  }
}
