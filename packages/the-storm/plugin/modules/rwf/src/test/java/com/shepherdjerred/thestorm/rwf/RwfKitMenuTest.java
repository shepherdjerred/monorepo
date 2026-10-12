package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.event.block.Action;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryAction;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.InventoryView;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * The kit selector and menu on MockBukkit: the lobby's nether star and red dye are given on joining
 * and after every pick, the star opens a read-only chest of the shipped kits, a click picks a kit
 * through the same path as {@code /rwf kit}, the dye leaves, and everything is gone once the match
 * is live. Other chests stay closed to members.
 */
final class RwfKitMenuTest {

  /** The menu's middle row holds the four kits a slot apart, in menu order. */
  private static final int TROOPER = 10;

  private static final int LONGBOW = 12;
  private static final int SELECTOR = 8;
  private static final int LEAVE = 7;

  @TempDir Path directory;
  private @Nullable RwfHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  private RwfHarness start() {
    running = RwfHarness.start(directory);
    return running;
  }

  private static Material at(PlayerMock player, int slot) {
    return Optional.ofNullable(player.getInventory().getItem(slot))
        .map(ItemStack::getType)
        .orElse(Material.AIR);
  }

  private static void rightClick(RwfHarness harness, PlayerMock player, int slot) {
    player.getInventory().setHeldItemSlot(slot);
    var item = requireNonNull(player.getInventory().getItem(slot));
    harness
        .server
        .getPluginManager()
        .callEvent(
            new PlayerInteractEvent(player, Action.RIGHT_CLICK_AIR, item, null, BlockFace.SELF));
  }

  private static InventoryClickEvent click(
      RwfHarness harness, InventoryView view, ClickType type, int rawSlot) {
    var slotType =
        rawSlot < view.getTopInventory().getSize()
            ? InventoryType.SlotType.CONTAINER
            : InventoryType.SlotType.QUICKBAR;
    var event = new InventoryClickEvent(view, slotType, rawSlot, type, InventoryAction.PICKUP_ALL);
    harness.server.getPluginManager().callEvent(event);
    return event;
  }

  private static boolean menuOpen(PlayerMock player) {
    var view = player.getOpenInventory();
    return view.getType() == InventoryType.CHEST && view.getTopInventory().getSize() == 27;
  }

  private static String name(ItemStack stack) {
    return PlainTextComponentSerializer.plainText()
        .serialize(requireNonNull(stack.getItemMeta().displayName()));
  }

  @Test
  void joiningAndPickingKeepTheSelectorAndTheLeaveItemInTheHotbar() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);

    assertThat(at(alice, SELECTOR)).isEqualTo(Material.NETHER_STAR);
    assertThat(at(alice, LEAVE)).isEqualTo(Material.RED_DYE);
    assertThat(name(requireNonNull(alice.getInventory().getItem(SELECTOR))))
        .isEqualTo("Choose kit");

    alice.performCommand("rwf kit longbow");

    assertThat(at(alice, 2)).isEqualTo(Material.BOW);
    assertThat(at(alice, SELECTOR)).isEqualTo(Material.NETHER_STAR);
    assertThat(at(alice, LEAVE)).isEqualTo(Material.RED_DYE);
  }

  @Test
  void theSelectorOpensAMenuOfTheShippedKitsWithThePickedOneGlinting() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    alice.performCommand("rwf kit shortbow");

    rightClick(harness, alice, SELECTOR);

    assertThat(menuOpen(alice)).isTrue();
    var top = alice.getOpenInventory().getTopInventory();
    var icons =
        List.of(top.getItem(10), top.getItem(12), top.getItem(14), top.getItem(16)).stream()
            .map(stack -> requireNonNull(stack))
            .toList();
    assertThat(icons)
        .extracting(ItemStack::getType)
        .containsExactly(Material.IRON_SWORD, Material.BOW, Material.ARROW, Material.CLOCK);
    assertThat(icons)
        .extracting(RwfKitMenuTest::name)
        .containsExactly("Trooper", "Longbow", "Shortbow", "Rewind");
    assertThat(icons)
        .extracting(icon -> icon.getItemMeta().getEnchantmentGlintOverride())
        .containsExactly(false, false, true, false);
    var occupied = 0;
    for (var slot = 0; slot < top.getSize(); slot++) {
      if (top.getItem(slot) != null) {
        occupied++;
      }
    }
    assertThat(occupied).as("only shipped kits, no placeholders").isEqualTo(4);
  }

  @Test
  void clickingLongbowPicksItKeepsTheSelectorAndClosesTheMenu() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    rightClick(harness, alice, SELECTOR);

    var click = click(harness, alice.getOpenInventory(), ClickType.LEFT, LONGBOW);

    assertThat(click.isCancelled()).isTrue();
    assertThat(harness.combatant(alice).kit()).contains("longbow");
    assertThat(at(alice, 2)).isEqualTo(Material.BOW);
    assertThat(at(alice, SELECTOR)).isEqualTo(Material.NETHER_STAR);
    harness.ticks(2);
    assertThat(menuOpen(alice)).isFalse();
  }

  @Test
  void nothingCanBeTakenFromOrMovedIntoTheMenu() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    rightClick(harness, alice, SELECTOR);
    var view = alice.getOpenInventory();

    // An empty slot of the chest, then the player's own hotbar below it: raw slot 27 + 27 + 8
    // is the selector.
    assertThat(click(harness, view, ClickType.SHIFT_LEFT, 0).isCancelled()).isTrue();
    assertThat(click(harness, view, ClickType.LEFT, 62).isCancelled()).isTrue();
    var drag =
        new InventoryDragEvent(
            view,
            null,
            ItemStack.of(Material.STONE),
            false,
            Map.of(TROOPER, ItemStack.of(Material.STONE)));
    harness.server.getPluginManager().callEvent(drag);
    assertThat(drag.isCancelled()).isTrue();
    assertThat(view.getTopInventory().getItem(TROOPER)).isNotNull();
    assertThat(requireNonNull(view.getTopInventory().getItem(TROOPER)).getType())
        .isEqualTo(Material.IRON_SWORD);
    assertThat(harness.combatant(alice).kit()).isEmpty();
    assertThat(at(alice, SELECTOR)).isEqualTo(Material.NETHER_STAR);

    // Even a shift-click on an icon only picks the kit; the icon stays in the menu.
    assertThat(click(harness, view, ClickType.SHIFT_LEFT, TROOPER).isCancelled()).isTrue();
    assertThat(requireNonNull(view.getTopInventory().getItem(TROOPER)).getType())
        .isEqualTo(Material.IRON_SWORD);
    assertThat(harness.combatant(alice).kit()).contains("trooper");
  }

  @Test
  void otherChestsStayClosedToMembers() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);

    alice.openInventory(harness.server.createInventory(null, 27));

    assertThat(menuOpen(alice)).isFalse();
  }

  @Test
  void goingLiveClosesTheMenuAndTakesTheLobbyItemsAway() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    rightClick(harness, alice, SELECTOR);
    assertThat(menuOpen(alice)).isTrue();

    harness.goLive(alice);

    assertThat(harness.snapshot().phase()).isEqualTo(MatchSnapshot.PhaseKind.LIVE);
    assertThat(menuOpen(alice)).isFalse();
    assertThat(alice.getInventory().contains(Material.NETHER_STAR)).isFalse();
    assertThat(alice.getInventory().contains(Material.RED_DYE)).isFalse();
    assertThat(at(alice, 0)).isEqualTo(Material.BLAZE_POWDER);
  }

  @Test
  void theLeaveItemLeavesTheMatch() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);

    rightClick(harness, alice, LEAVE);

    assertThat(harness.inMatch(alice)).isFalse();
    assertThat(alice.getWorld()).isEqualTo(harness.overworld);
    assertThat(alice.getInventory().contains(Material.RED_DYE)).isFalse();
    assertThat(alice.getInventory().contains(Material.DIAMOND, 5)).isTrue();
  }
}
