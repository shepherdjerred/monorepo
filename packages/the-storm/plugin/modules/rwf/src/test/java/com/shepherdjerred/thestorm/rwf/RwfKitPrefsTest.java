package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.adapter.db.JooqKitStore;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitLayout;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.event.block.Action;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryAction;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * What a player keeps between matches: the layout editor a right-click in the kit menu opens, the
 * saved layout every later equip follows, and the last kit played picked again on joining.
 */
final class RwfKitPrefsTest {

  private static final int TROOPER = KitBook.ALL.indexOf(KitBook.TROOPER);
  private static final int SELECTOR = 8;

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

  private static void openMenu(RwfHarness harness, PlayerMock player) {
    player.getInventory().setHeldItemSlot(SELECTOR);
    var item = requireNonNull(player.getInventory().getItem(SELECTOR));
    harness
        .server
        .getPluginManager()
        .callEvent(
            new PlayerInteractEvent(player, Action.RIGHT_CLICK_AIR, item, null, BlockFace.SELF));
    harness.until(() -> chest(player, 54));
  }

  /** Whether {@code player} has a chest of {@code size} slots open. */
  private static boolean chest(PlayerMock player, int size) {
    var view = player.getOpenInventory();
    return view.getType() == InventoryType.CHEST && view.getTopInventory().getSize() == size;
  }

  private static InventoryClickEvent click(
      RwfHarness harness, PlayerMock player, ClickType type, int rawSlot) {
    var view = player.getOpenInventory();
    var event =
        new InventoryClickEvent(
            view, InventoryType.SlotType.CONTAINER, rawSlot, type, InventoryAction.PICKUP_ALL);
    harness.server.getPluginManager().callEvent(event);
    return event;
  }

  @Test
  void aLayoutSavedInTheEditorIsHowTheKitIsHandedOut() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    openMenu(harness, alice);

    click(harness, alice, ClickType.RIGHT, TROOPER);
    harness.until(() -> chest(alice, 36));
    var editor = alice.getOpenInventory().getTopInventory();
    // The hotbar is the bottom row: the sword in slot 1, the apples in slot 2.
    assertThat(requireNonNull(editor.getItem(28)).getType()).isEqualTo(Material.IRON_SWORD);
    assertThat(requireNonNull(editor.getItem(29)).getType()).isEqualTo(Material.GOLDEN_APPLE);
    assertThat(click(harness, alice, ClickType.LEFT, 27).isCancelled())
        .as("the fuse stays put")
        .isTrue();
    var sword = editor.getItem(28);
    editor.setItem(28, editor.getItem(29));
    editor.setItem(29, sword);
    alice.closeInventory();

    harness.until(
        () ->
            new JooqKitStore(harness.database)
                .prefs(alice.getUniqueId())
                .join()
                .layout("trooper")
                .isPresent());
    assertThat(
            new JooqKitStore(harness.database).prefs(alice.getUniqueId()).join().layout("trooper"))
        .contains(new KitLayout(Map.of(0, 0, 1, 2, 2, 1)));
    harness.until(
        () ->
            RwfHarness.messages(alice).stream()
                .anyMatch(message -> message.contains("Saved your Trooper layout")));
    alice.performCommand("rwf kit trooper");
    assertThat(at(alice, 1)).isEqualTo(Material.GOLDEN_APPLE);
    assertThat(at(alice, 2)).isEqualTo(Material.IRON_SWORD);
  }

  @Test
  void theKitLastPlayedIsPickedAgainOnJoining() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    // Saving a layout writes Alice's prefs row; the stats write her last kit into it.
    new JooqKitStore(harness.database)
        .saveLayout(alice.getUniqueId(), "longbow", KitLayout.of(KitBook.LONGBOW))
        .join();
    harness
        .database
        .write(
            dsl ->
                dsl.execute(
                    "UPDATE rwf_player_prefs SET last_kit = 'longbow' WHERE player = ?",
                    alice.getUniqueId().toString()))
        .join();

    harness.enter(alice);

    harness.until(() -> harness.combatant(alice).kit().filter("longbow"::equals).isPresent());
    assertThat(at(alice, 2)).isEqualTo(Material.BOW);
  }

  @Test
  void failedLayoutWriteReportsFailureAndKeepsThePreviousEquipUntilSuccessfulRetry() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    harness
        .database
        .write(
            dsl ->
                dsl.execute(
                    "CREATE TRIGGER reject_layout BEFORE INSERT ON rwf_player_prefs "
                        + "BEGIN SELECT RAISE(ABORT, 'layout unavailable'); END"))
        .join();

    swapSwordAndApples(harness, alice);
    harness.until(
        () ->
            RwfHarness.messages(alice).stream()
                .anyMatch(message -> message.contains("layout could not be saved; try again")));
    assertThat(
            new JooqKitStore(harness.database).prefs(alice.getUniqueId()).join().layout("trooper"))
        .isEmpty();
    alice.performCommand("rwf kit trooper");
    assertThat(at(alice, 1)).isEqualTo(Material.IRON_SWORD);
    assertThat(at(alice, 2)).isEqualTo(Material.GOLDEN_APPLE);
    harness.database.write(dsl -> dsl.execute("DROP TRIGGER reject_layout")).join();

    swapSwordAndApples(harness, alice);
    harness.until(
        () ->
            RwfHarness.messages(alice).stream()
                .anyMatch(message -> message.contains("Saved your Trooper layout")));
    alice.performCommand("rwf kit trooper");
    assertThat(at(alice, 1)).isEqualTo(Material.GOLDEN_APPLE);
    assertThat(at(alice, 2)).isEqualTo(Material.IRON_SWORD);
    assertThat(
            new JooqKitStore(harness.database).prefs(alice.getUniqueId()).join().layout("trooper"))
        .contains(new KitLayout(Map.of(0, 0, 1, 2, 2, 1)));
  }

  private static void swapSwordAndApples(RwfHarness harness, PlayerMock player) {
    openMenu(harness, player);
    click(harness, player, ClickType.RIGHT, TROOPER);
    harness.until(() -> chest(player, 36));
    var editor = player.getOpenInventory().getTopInventory();
    var sword = editor.getItem(28);
    editor.setItem(28, editor.getItem(29));
    editor.setItem(29, sword);
    player.closeInventory();
  }
}
