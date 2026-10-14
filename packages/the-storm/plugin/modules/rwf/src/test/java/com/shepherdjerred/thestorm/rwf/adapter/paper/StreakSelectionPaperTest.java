package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.RwfHarness;
import com.shepherdjerred.thestorm.rwf.app.FeatureGates;
import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.Killstreak;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.StreakLoadout;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Material;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryAction;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryType;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

final class StreakSelectionPaperTest {
  @TempDir Path directory;
  private @Nullable RwfHarness running;

  private RwfHarness start(boolean enabled) {
    var harness = RwfHarness.prepare(directory);
    running = harness;
    harness.kitGates =
        new FeatureGates(JoinGate.open(), _ -> CompletableFuture.completedFuture(enabled));
    return harness.enable(directory);
  }

  @AfterEach
  void stop() {
    if (running != null) running.close();
  }

  private static StreakLoadout selected(RwfHarness harness, PlayerMock player) {
    return ((MatchRunner) harness.view()).memberOf(player.getUniqueId()).orElseThrow().streaks();
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
  }

  @Test
  void commandAndGuiShareValidatedSelectionsWithoutMovingLobbyItems() {
    var harness = start(true);
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    assertThat(selected(harness, alice)).isEqualTo(StreakLoadout.DEFAULT);
    alice.performCommand("rwf killstreaks compass supply-crate wolves");
    harness.ticks(2);
    assertThat(selected(harness, alice)).isEqualTo(StreakLoadout.DEFAULT);
    alice.performCommand("rwf killstreaks");
    harness.until(
        () ->
            alice.getOpenInventory().getType() == InventoryType.CHEST
                && alice.getOpenInventory().getTopInventory().getHolder() instanceof StreakMenu);
    click(harness, alice, 12);
    click(harness, alice, StreakMenu.SAVE);
    var wolves =
        new StreakLoadout(List.of(Killstreak.COMPASS, Killstreak.WOLVES, Killstreak.IRON_GOLEM));
    harness.until(() -> selected(harness, alice).equals(wolves));
    assertThat(alice.getInventory().getItem(KitFactory.SELECTOR_SLOT))
        .isNotNull()
        .satisfies(item -> assertThat(item.getType()).isEqualTo(Material.NETHER_STAR));
    assertThat(alice.getInventory().getItem(KitFactory.LEAVE_SLOT))
        .isNotNull()
        .satisfies(item -> assertThat(item.getType()).isEqualTo(Material.RED_DYE));
    alice.performCommand("rwf killstreaks compass wolves napalm");
    var napalm =
        new StreakLoadout(List.of(Killstreak.COMPASS, Killstreak.WOLVES, Killstreak.NAPALM));
    harness.until(() -> selected(harness, alice).equals(napalm));
  }

  @Test
  void theExistingFeatureGateControlsSelectionAvailability() {
    var harness = start(false);
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    RwfHarness.messages(alice);
    alice.performCommand("rwf killstreaks compass wolves napalm");
    harness.ticks(4);
    assertThat(selected(harness, alice)).isEqualTo(StreakLoadout.DEFAULT);
    assertThat(RwfHarness.messages(alice)).anyMatch(line -> line.contains("not available to you"));
  }

  @Test
  void liveLifeKeepsItsChoicesAndARejoinReadsSavedPreferences() {
    var harness = start(true);
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    alice.performCommand("rwf killstreaks compass wolves napalm");
    var selected =
        new StreakLoadout(List.of(Killstreak.COMPASS, Killstreak.WOLVES, Killstreak.NAPALM));
    harness.until(() -> selected(harness, alice).equals(selected));
    alice.performCommand("rwf leave");
    harness.rejoinAfterSave(alice);
    harness.enter(alice);
    assertThat(selected(harness, alice)).isEqualTo(selected);
    harness.goLive(alice);
    alice.performCommand("rwf killstreaks compass supply-crate iron-golem");
    harness.ticks(3);
    assertThat(selected(harness, alice)).isEqualTo(selected);
  }
}
