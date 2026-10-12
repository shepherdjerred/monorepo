package com.shepherdjerred.thestorm.core.world;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.bukkit.Location;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;

final class SealedWorldsTest {

  private ServerMock server;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void sealsByNameAndAnswersForWorldsAndLocations() {
    var arena = server.addSimpleWorld("arena");
    var overworld = server.addSimpleWorld("world");
    var sealed = new SealedWorlds();

    sealed.seal(arena);
    sealed.seal("arena");

    assertThat(sealed.isSealed(arena)).isTrue();
    assertThat(sealed.isSealed("arena")).isTrue();
    assertThat(sealed.isSealed(new Location(arena, 1, 2, 3))).isTrue();
    assertThat(sealed.isSealed(overworld)).isFalse();
    assertThat(sealed.isSealed(new Location(overworld, 1, 2, 3))).isFalse();
    assertThat(sealed.names()).containsExactly("arena");

    sealed.unseal("arena");
    sealed.unseal("never-sealed");
    assertThat(sealed.isSealed(arena)).isFalse();
    assertThat(sealed.names()).isEmpty();
  }

  @Test
  void aLocationWithoutAWorldIsACallerBug() {
    var sealed = new SealedWorlds();
    var nowhere = new Location(null, 0, 0, 0);
    assertThatThrownBy(() -> sealed.isSealed(nowhere)).isInstanceOf(IllegalArgumentException.class);
  }
}
