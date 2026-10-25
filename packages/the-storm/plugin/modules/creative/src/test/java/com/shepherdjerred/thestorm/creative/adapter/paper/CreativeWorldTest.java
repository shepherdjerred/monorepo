package com.shepherdjerred.thestorm.creative.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.creative.domain.CreativeConfig;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import java.util.List;
import org.bukkit.GameRules;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;

/** The recovered map stays pasted: leaves, fire, and the other terrain ticks stay off. */
final class CreativeWorldTest {

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
  void freezesTerrainTicksOnTheCreativeWorld() {
    var world = server.addSimpleWorld("creative");

    CreativeWorld.apply(world, recovered());

    assertThat(world.getGameRuleValue(GameRules.RANDOM_TICK_SPEED)).isZero();
    assertThat(world.getGameRuleValue(GameRules.FIRE_SPREAD_RADIUS_AROUND_PLAYER)).isZero();
    assertThat(world.getGameRuleValue(GameRules.MOB_GRIEFING)).isFalse();
    assertThat(world.getGameRuleValue(GameRules.TNT_EXPLODES)).isFalse();
    assertThat(world.getGameRuleValue(GameRules.SPREAD_VINES)).isFalse();
    assertThat(world.getGameRuleValue(GameRules.MAX_SNOW_ACCUMULATION_HEIGHT)).isZero();
    assertThat(world.getGameRuleValue(GameRules.LAVA_SOURCE_CONVERSION)).isFalse();
    assertThat(world.getGameRuleValue(GameRules.WATER_SOURCE_CONVERSION)).isFalse();
    assertThat(world.getGameRuleValue(GameRules.PROJECTILES_CAN_BREAK_BLOCKS)).isFalse();
    assertThat(world.getGameRuleValue(GameRules.ADVANCE_TIME)).isFalse();
    assertThat(world.getGameRuleValue(GameRules.SPAWN_MOBS)).isFalse();
    assertThat(world.getGameRuleValue(GameRules.KEEP_INVENTORY)).isTrue();
  }

  private static CreativeConfig recovered() {
    return new CreativeConfig(
        "creative",
        PlotGrid.PLOT_WIDTH,
        PlotGrid.ROAD_WIDTH,
        PlotGrid.ROAD_OFFSET_X,
        PlotGrid.ROAD_OFFSET_Z,
        PlotGrid.SURFACE_Y,
        PlotGrid.SURVEYED_BORDER_CENTER_X,
        PlotGrid.SURVEYED_BORDER_CENTER_Z,
        PlotGrid.SURVEYED_BORDER_SIZE,
        2,
        200,
        8,
        140,
        20,
        List.of());
  }
}
