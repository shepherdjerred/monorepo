package com.shepherdjerred.thestorm.world.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.world.domain.AmbientConfig;
import java.time.Instant;
import java.time.InstantSource;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

final class AmbientBarksTest {

  private ServerMock server;
  private WorldMock world;
  private WorldMock wilds;
  private PlayerMock player;
  private Plugin plugin;
  private AmbientBarks barks;

  @BeforeEach
  void setUp() {
    server = MockBukkit.mock();
    world = server.addSimpleWorld("world");
    wilds = server.addSimpleWorld("wilds");
    player = server.addPlayer();
    plugin = MockBukkit.createMockPlugin();
    barks = new AmbientBarks(plugin, configAtBukkitSpawn(), fixed("2026-09-27T06:30:00Z"));
  }

  @AfterEach
  void tearDown() {
    MockBukkit.unmock();
  }

  @Test
  void greetsAtSpawnOnlyOncePerPacificDateAcrossListeners() {
    player.teleport(world.getSpawnLocation());
    barks.onJoin(new PlayerJoinEvent(player, Component.empty()));
    assertThat(nextLine()).contains("Crier:", "windmill");
    barks.onJoin(new PlayerJoinEvent(player, Component.empty()));
    assertThat(nextLine()).isNull();

    var sameDay = new AmbientBarks(plugin, configAtBukkitSpawn(), fixed("2026-09-27T06:59:00Z"));
    sameDay.onJoin(new PlayerJoinEvent(player, Component.empty()));
    assertThat(nextLine()).isNull();

    var tomorrow = new AmbientBarks(plugin, configAtBukkitSpawn(), fixed("2026-09-27T07:30:00Z"));
    tomorrow.onJoin(new PlayerJoinEvent(player, Component.empty()));
    assertThat(nextLine()).contains("Crier:");
  }

  @Test
  void ignoresOtherWorldsAndSpeaksWhenThePlayerReturnsToMainWorldSpawn() {
    player.teleport(wilds.getSpawnLocation());
    barks.onWorldChange(new PlayerChangedWorldEvent(player, world));
    assertThat(nextLine()).isNull();

    player.teleport(world.getSpawnLocation());
    barks.onWorldChange(new PlayerChangedWorldEvent(player, wilds));
    assertThat(nextLine()).contains("Crier:");
  }

  @Test
  void speaksOnRadiusEntryButNotOnEveryMoveOrDeepBelowSpawn() {
    var spawn = world.getSpawnLocation();
    var outside = spawn.clone().add(25, 0, 0);
    var inside = spawn.clone().add(24, 0, 0);
    barks.onMove(new PlayerMoveEvent(player, outside, inside));
    assertThat(nextLine()).contains("Crier:");

    barks.onMove(new PlayerMoveEvent(player, inside, spawn));
    assertThat(nextLine()).isNull();

    var anotherPlayer = server.addPlayer();
    var deep = new Location(world, spawn.getX(), spawn.getY() - 9, spawn.getZ());
    barks.onMove(new PlayerMoveEvent(anotherPlayer, outside, deep));
    assertThat(anotherPlayer.nextComponentMessage()).isNull();
  }

  @Test
  void refusesCorruptPersistentDayInsteadOfSilentlyResettingIt() {
    player.teleport(world.getSpawnLocation());
    player
        .getPersistentDataContainer()
        .set(new NamespacedKey(plugin, "ambient_bark_day"), PersistentDataType.STRING, "invalid");
    assertThatThrownBy(() -> barks.onJoin(new PlayerJoinEvent(player, Component.empty())))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("invalid ambient bark day");
  }

  @Test
  void centersTheBarkOnGameplaySpawnInsteadOfBukkitSpawn() {
    var gameplay =
        new AmbientBarks(
            plugin,
            new AmbientConfig(true, "world", -440, 71, -66, 24, 8, "America/Los_Angeles"),
            fixed("2026-09-27T06:30:00Z"));
    player.teleport(world.getSpawnLocation());
    gameplay.onJoin(new PlayerJoinEvent(player, Component.empty()));
    assertThat(nextLine()).isNull();

    player.teleport(new Location(world, -439.48, 71, -65.59));
    gameplay.onJoin(new PlayerJoinEvent(player, Component.empty()));
    assertThat(nextLine()).contains("Crier:");
  }

  private AmbientConfig configAtBukkitSpawn() {
    var spawn = world.getSpawnLocation();
    return new AmbientConfig(
        true,
        "world",
        spawn.getBlockX(),
        spawn.getBlockY(),
        spawn.getBlockZ(),
        24,
        8,
        "America/Los_Angeles");
  }

  private @Nullable String nextLine() {
    var message = player.nextComponentMessage();
    return message == null ? null : PlainTextComponentSerializer.plainText().serialize(message);
  }

  private static InstantSource fixed(String instant) {
    return InstantSource.fixed(Instant.parse(instant));
  }
}
