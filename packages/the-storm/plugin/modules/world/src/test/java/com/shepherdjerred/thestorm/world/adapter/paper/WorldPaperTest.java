package com.shepherdjerred.thestorm.world.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.world.domain.WorldConfig;
import java.nio.file.Path;
import org.bukkit.GameRules;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;

final class WorldPaperTest {

  private ServerMock server;
  private WorldConfig config;

  @BeforeEach
  void setUp() {
    server = MockBukkit.mock();
    config =
        ConfigFiles.load(
            Path.of("../../../server/owned/plugins/TheStorm/world.yml"), WorldConfig.class);
  }

  @AfterEach
  void tearDown() {
    MockBukkit.unmock();
  }

  @Test
  void installsNativeBordersAndSleepRuleOnProvisionedWorlds() {
    for (var name :
        java.util.List.of("world", "world_nether", "world_the_end", "wilds", "peaks", "mining")) {
      server.addSimpleWorld(name);
    }
    WorldPaper.install(server, config);
    for (var spec : config.borders()) {
      var world = java.util.Objects.requireNonNull(server.getWorld(spec.world()));
      assertThat(world.getWorldBorder().getSize()).isEqualTo(spec.size());
      assertThat(world.getWorldBorder().getCenter().getX()).isEqualTo(spec.centerX());
      assertThat(world.getWorldBorder().getCenter().getZ()).isEqualTo(spec.centerZ());
    }
    assertThat(server.getWorlds())
        .allSatisfy(
            world ->
                assertThat(world.getGameRuleValue(GameRules.PLAYERS_SLEEPING_PERCENTAGE))
                    .isEqualTo(50));
  }

  @Test
  void doesNotCreateAbsentResourceWorlds() {
    server.addSimpleWorld("world");
    assertThatThrownBy(() -> WorldPaper.install(server, config))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("wilds must be provisioned");
    assertThat(server.getWorld("wilds")).isNull();
  }

  @Test
  void rejectsMissingBorderWorld() {
    for (var spec : config.worlds()) {
      server.addSimpleWorld(spec.name());
    }
    assertThatThrownBy(() -> WorldPaper.install(server, config))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("border world world must be loaded");
  }
}
