package com.shepherdjerred.thestorm.core.snapshot;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.bukkit.GameMode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;

final class PlayerStatesTest {
  private ServerMock server;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    server.addSimpleWorld("world");
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @ParameterizedTest
  @EnumSource(GameMode.class)
  void captureAndRestorePreserveOriginalFlightAndImmunity(GameMode mode) {
    var player = server.addPlayer();
    player.setGameMode(mode);
    player.setAllowFlight(true);
    player.setFlying(true);
    player.setFlySpeed(0.35f);
    player.setMaximumNoDamageTicks(13);
    var snapshot = PlayerStates.capture(player, "rwf", Instant.EPOCH);
    assertThat(snapshot.vitals().formatVersion()).isEqualTo(2);

    PlayerStates.wipe(player, GameMode.ADVENTURE);
    player.setFlySpeed(0.1f);
    player.setMaximumNoDamageTicks(0);
    assertThat(player.getAllowFlight()).isFalse();
    assertThat(player.isFlying()).isFalse();

    assertThat(PlayerStates.apply(player, snapshot, server)).isTrue();
    assertThat(player.getGameMode()).isEqualTo(mode);
    assertThat(player.getAllowFlight()).isTrue();
    assertThat(player.isFlying()).isTrue();
    assertThat(player.getFlySpeed()).isEqualTo(0.35f);
    assertThat(player.getMaximumNoDamageTicks()).isEqualTo(13);
  }

  @ParameterizedTest
  @EnumSource(
      value = GameMode.class,
      names = {"SURVIVAL", "ADVENTURE"})
  void wipingGrantedGameFlightDoesNotChangeArenaDamageRules(GameMode mode) {
    var player = server.addPlayer();
    player.setAllowFlight(true);
    player.setFlying(true);
    player.setMaximumNoDamageTicks(11);
    PlayerStates.wipe(player, mode);
    assertThat(player.isFlying()).isFalse();
    assertThat(player.getAllowFlight()).isFalse();
    assertThat(player.getMaximumNoDamageTicks()).isEqualTo(11);
  }

  @ParameterizedTest
  @EnumSource(
      value = GameMode.class,
      names = {"CREATIVE", "SPECTATOR"})
  void wipingCreativeAndSpectatorDoesNotRevokeTheirFlight(GameMode mode) {
    var player = server.addPlayer();
    player.setGameMode(mode);
    player.setAllowFlight(true);
    player.setFlying(true);
    PlayerStates.wipe(player, mode);
    assertThat(player.getAllowFlight()).isTrue();
    assertThat(player.isFlying()).isTrue();
  }

  @Test
  void ordinarySurvivalRestoreRevokesCelebrationFlight() {
    var player = server.addPlayer();
    player.setGameMode(GameMode.SURVIVAL);
    player.setAllowFlight(false);
    player.setMaximumNoDamageTicks(20);
    var snapshot = PlayerStates.capture(player, "rwf", Instant.EPOCH);
    player.setAllowFlight(true);
    player.setFlying(true);
    player.setMaximumNoDamageTicks(0);
    PlayerStates.apply(player, snapshot, server);
    assertThat(player.getAllowFlight()).isFalse();
    assertThat(player.isFlying()).isFalse();
    assertThat(player.getMaximumNoDamageTicks()).isEqualTo(20);
  }
}
