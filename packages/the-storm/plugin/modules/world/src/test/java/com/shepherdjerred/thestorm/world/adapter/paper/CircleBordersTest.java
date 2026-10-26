package com.shepherdjerred.thestorm.world.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.world.domain.CircleEdge;
import java.util.List;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

final class CircleBordersTest {
  private World world;
  private Player player;

  @BeforeEach
  void setUp() {
    var server = MockBukkit.mock();
    world = server.addSimpleWorld("skylands");
    player = server.addPlayer();
  }

  @AfterEach
  void tearDown() {
    MockBukkit.unmock();
  }

  private CircleBorders borders() {
    return new CircleBorders(List.of(new CircleEdge("skylands", 0, 0, 3000)), Runnable::run);
  }

  @Test
  void stopsDiagonalMovementBeforeTheSquareNativeBorder() {
    var borders = borders();
    var event =
        new PlayerMoveEvent(
            player, new Location(world, 2100, 80, 2100), new Location(world, 2200, 80, 2200));
    borders.onMove(event);
    assertThat(event.isCancelled()).isTrue();
  }

  @Test
  void rejectsOutsideTeleportsAndAllowsTheExactRadius() {
    var borders = borders();
    var outside =
        new PlayerTeleportEvent(
            player, new Location(world, 0, 80, 0), new Location(world, 3000, 80, 1));
    borders.onTeleport(outside);
    assertThat(outside.isCancelled()).isTrue();
    var edge =
        new PlayerTeleportEvent(
            player, new Location(world, 0, 80, 0), new Location(world, 3000, 80, 0));
    borders.onTeleport(edge);
    assertThat(edge.isCancelled()).isFalse();
  }

  @Test
  void replacesOutsideRespawnWithExistingSpawnAboveTheVoid() {
    var borders = borders();
    var spawn = new Location(world, 0, 80, 0);
    world.setSpawnLocation(spawn);
    var event =
        new PlayerRespawnEvent(
            player,
            new Location(world, 2900, 80, 2900),
            false,
            false,
            false,
            PlayerRespawnEvent.RespawnReason.DEATH);
    borders.onRespawn(event);
    assertThat(event.getRespawnLocation()).isEqualTo(spawn);
  }
}
