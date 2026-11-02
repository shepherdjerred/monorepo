package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.players.VisitPasses;
import java.util.UUID;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.junit.jupiter.api.Test;

/** An accepted visit is spent by a plugin teleport and left alone for an ender pearl. */
final class AcceptedVisitTest {

  @Test
  void aPluginTeleportSpendsThePassAndAPearlDoesNot() {
    var visits = new VisitPasses();
    var player = UUID.randomUUID();
    visits.allowNextPluginTeleport(player);

    assertThat(
            MovementListener.acceptedVisit(
                visits, player, PlayerTeleportEvent.TeleportCause.ENDER_PEARL))
        .isFalse();
    assertThat(
            MovementListener.acceptedVisit(
                visits, player, PlayerTeleportEvent.TeleportCause.PLUGIN))
        .isTrue();
    assertThat(
            MovementListener.acceptedVisit(
                visits, player, PlayerTeleportEvent.TeleportCause.PLUGIN))
        .isFalse();
  }
}
