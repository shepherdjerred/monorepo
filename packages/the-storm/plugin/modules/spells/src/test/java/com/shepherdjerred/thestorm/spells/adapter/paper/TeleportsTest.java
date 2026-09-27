package com.shepherdjerred.thestorm.spells.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

final class TeleportsTest {

  private final Harness harness = new Harness();

  @AfterEach
  void tearDown() {
    harness.close();
  }

  @Test
  void aCancelledPluginTeleportReportsFailureAndKeepsFallDistance() {
    var player = harness.server.addPlayer();
    var from = player.getLocation();
    var destination = from.clone().add(3, 0, 0);
    player.setFallDistance(7);
    harness.server.getPluginManager().registerEvents(new TeleportVeto(), harness.plugin);

    assertThat(Teleports.teleport(player, destination)).isFalse();
    assertThat(player.getLocation()).isEqualTo(from);
    assertThat(player.getFallDistance()).isEqualTo(7);
  }

  static final class TeleportVeto implements Listener {
    @EventHandler
    void veto(PlayerTeleportEvent event) {
      if (event.getCause() == PlayerTeleportEvent.TeleportCause.PLUGIN) {
        event.setCancelled(true);
      }
    }
  }
}
