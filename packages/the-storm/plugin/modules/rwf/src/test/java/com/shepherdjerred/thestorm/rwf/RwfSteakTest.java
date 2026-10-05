package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * Steak heals at once on a right-click into the air, which Bukkit raises already cancelled, and is
 * left uneaten within a point of full health.
 */
final class RwfSteakTest {

  @TempDir Path directory;
  private @Nullable RwfHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  private static PlayerInteractEvent clickAir(PlayerMock player, ItemStack steak) {
    return new PlayerInteractEvent(
        player, Action.RIGHT_CLICK_AIR, steak, null, BlockFace.SELF, EquipmentSlot.HAND);
  }

  @Test
  void aRightClickIntoTheAirEatsASteakAtOnce() {
    running = RwfHarness.start(directory);
    var harness = requireNonNull(running);
    var alice = harness.loadedPlayer("Alice");
    harness.goLive(alice);
    var steak = new ItemStack(Material.COOKED_BEEF, 2);
    alice.getInventory().setItemInMainHand(steak);
    var events = harness.server.getPluginManager();

    var full = clickAir(alice, steak);
    assertThat(full.useInteractedBlock())
        .as("Bukkit raises an air click cancelled")
        .isEqualTo(Event.Result.DENY);
    events.callEvent(full);
    assertThat(steak.getAmount()).as("refused at full health").isEqualTo(2);
    assertThat(RwfHarness.messages(alice)).contains("[RWF]: You are too healthy to eat that.");

    alice.setHealth(10);
    events.callEvent(clickAir(alice, steak));

    assertThat(alice.getHealth()).isEqualTo(18);
    assertThat(steak.getAmount()).isEqualTo(1);
  }
}
