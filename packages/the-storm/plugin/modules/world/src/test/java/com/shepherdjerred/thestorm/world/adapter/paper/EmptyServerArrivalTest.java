package com.shepherdjerred.thestorm.world.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import org.bukkit.event.player.PlayerJoinEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

final class EmptyServerArrivalTest {
  private ServerMock server;
  private WorldMock world;
  private WorldMock frontier;
  private EmptyServerArrival listener;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    world = server.addSimpleWorld("world");
    frontier = server.addSimpleWorld("frontier");
    listener = new EmptyServerArrival(server);
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void firstHumanGetsAClearMorningInEveryOverworld() {
    world.setTime(18000);
    frontier.setTime(18000);
    world.setStorm(true);
    frontier.setThundering(true);

    listener.onJoin(
        new PlayerJoinEvent(
            server.addPlayer("first"), net.kyori.adventure.text.Component.text("joined")));

    for (var target : new WorldMock[] {world, frontier}) {
      assertThat(target.getTime()).isEqualTo(1000);
      assertThat(target.hasStorm()).isFalse();
      assertThat(target.isThundering()).isFalse();
    }
  }

  @Test
  void laterJoinsDoNotChangeTimeOrWeather() {
    listener.onJoin(
        new PlayerJoinEvent(
            server.addPlayer("first"), net.kyori.adventure.text.Component.text("joined")));
    world.setTime(18000);
    world.setStorm(true);

    listener.onJoin(
        new PlayerJoinEvent(
            server.addPlayer("second"), net.kyori.adventure.text.Component.text("joined")));

    assertThat(world.getTime()).isEqualTo(18000);
    assertThat(world.hasStorm()).isTrue();
  }
}
