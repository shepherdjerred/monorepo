package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.app.BotDifficulty;
import com.shepherdjerred.thestorm.rwf.app.RwfFeatures;
import java.nio.file.Path;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.event.block.Action;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryAction;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.player.PlayerInteractEvent;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** Player-facing host ownership and settings isolation, driven through their actual menu events. */
final class RwfSettingsMenuTest {
  @TempDir Path directory;
  private @Nullable RwfHarness running;

  private RwfHarness start(boolean enabled) {
    var harness = RwfHarness.prepare(directory);
    running = harness;
    harness.features =
        enabled
            ? new RwfFeatures(true, true, true, true, true, true, true, true, false)
            : RwfFeatures.NONE;
    return harness.enable(directory);
  }

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  private static void open(RwfHarness harness, PlayerMock player) {
    var item = requireNonNull(player.getInventory().getItem(6));
    harness
        .server
        .getPluginManager()
        .callEvent(
            new PlayerInteractEvent(player, Action.RIGHT_CLICK_AIR, item, null, BlockFace.SELF));
    assertThat(player.getOpenInventory().getTopInventory().getSize()).isEqualTo(27);
  }

  private static String label(PlayerMock player, int slot) {
    var item = requireNonNull(player.getOpenInventory().getTopInventory().getItem(slot));
    return PlainTextComponentSerializer.plainText()
        .serialize(requireNonNull(item.getItemMeta().displayName()));
  }

  private static void click(RwfHarness harness, PlayerMock player, int slot) {
    var event =
        new InventoryClickEvent(
            player.getOpenInventory(),
            InventoryType.SlotType.CONTAINER,
            slot,
            ClickType.LEFT,
            InventoryAction.PICKUP_ALL);
    harness.server.getPluginManager().callEvent(event);
    assertThat(event.isCancelled()).isTrue();
    harness.ticks(2);
  }

  @Test
  void firstHumanHostsOthersCannotEditAndTheNextHumanInheritsPreferences() {
    var harness = start(true);
    var alice = harness.loadedPlayer("Alice");
    var bob = harness.loadedPlayer("Bob");
    harness.enter(alice);
    harness.enter(bob);
    open(harness, alice);
    assertThat(label(alice, 4)).isEqualTo("Host: Alice");
    assertThat(label(alice, 22)).isEqualTo("Next-round settings");
    click(harness, alice, 11);
    assertThat(label(alice, 13)).isEqualTo("Population: Off");
    open(harness, bob);
    click(harness, bob, 14);
    assertThat(label(bob, 13)).isEqualTo("Population: Off");
    alice.performCommand("rwf leave");
    open(harness, bob);
    assertThat(label(bob, 4)).isEqualTo("Host: Bob");
    assertThat(label(bob, 13)).isEqualTo("Population: Off");
    bob.performCommand("rwf leave");
    var charlie = harness.loadedPlayer("Charlie");
    harness.enter(charlie);
    open(harness, charlie);
    assertThat(label(charlie, 4)).isEqualTo("Host: Charlie");
    assertThat(label(charlie, 13)).isEqualTo("Population: Auto");
  }

  @Test
  void optionsOpensTheHostMenuWhileSettingsStillReadsTheExperience() {
    var harness = start(true);
    var alice = harness.loadedPlayer("Alice");
    var bob = harness.loadedPlayer("Bob");
    harness.enter(alice);
    harness.enter(bob);
    alice.closeInventory();
    RwfHarness.messages(alice);
    alice.performCommand("rwf settings");
    assertThat(RwfHarness.messages(alice)).anyMatch(line -> line.contains("Next draft:"));
    assertThat(alice.getOpenInventory().getTopInventory()).isNull();
    alice.performCommand("rwf options");
    assertThat(label(alice, 4)).isEqualTo("Host: Alice");
    click(harness, alice, 11);
    assertThat(label(alice, 13)).isEqualTo("Population: Off");
    bob.performCommand("rwf options");
    click(harness, bob, 14);
    assertThat(label(bob, 13)).isEqualTo("Population: Off");
  }

  @Test
  void optionsRequiresMembershipWhenTheRolloutIsEnabled() {
    var harness = start(true);
    var alice = harness.loadedPlayer("Alice");
    alice.performCommand("rwf options");
    assertThat(alice.getOpenInventory().getTopInventory()).isNull();
  }

  @Test
  void rolloutOffDoesNotAllowOptionsEvenForAMember() {
    var harness = start(false);
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    alice.closeInventory();
    alice.performCommand("rwf options");
    assertThat(alice.getOpenInventory().getTopInventory()).isNull();
  }

  @Test
  void rolloutOffRetainsAdaptiveDifficultyAndHasNoSettingsItem() {
    var harness = start(false);
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    harness.until(() -> harness.bots.lastDraft().isPresent());
    assertThat(harness.bots.lastDraft().orElseThrow().difficulty()).isEmpty();
    var item = alice.getInventory().getItem(6);
    assertThat(item == null || item.getType() != Material.COMPARATOR).isTrue();
  }

  @Test
  void rolloutOnFreezesAnExplicitNormalDifficultyAtTheVoteClose() {
    var harness = start(true);
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    harness.until(() -> harness.bots.lastDraft().isPresent());
    assertThat(harness.bots.lastDraft().orElseThrow().difficulty()).contains(BotDifficulty.NORMAL);
    open(harness, alice);
    click(harness, alice, 15);
    assertThat(label(alice, 15)).isEqualTo("Difficulty: Hard");
    assertThat(harness.bots.lastDraft().orElseThrow().difficulty()).contains(BotDifficulty.NORMAL);
  }
}
