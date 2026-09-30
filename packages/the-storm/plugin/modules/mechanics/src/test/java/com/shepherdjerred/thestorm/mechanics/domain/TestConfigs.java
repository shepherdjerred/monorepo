package com.shepherdjerred.thestorm.mechanics.domain;

import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.FENCE;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.PLANKS;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.SPRUCE;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.SPRUCE_FENCE;

import com.shepherdjerred.thestorm.mechanics.domain.config.Access;
import com.shepherdjerred.thestorm.mechanics.domain.config.BlockDropsConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.CookingPotConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.ElevatorConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.GateConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.HiddenSwitchConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.LightSwitchConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.MechanicsConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.PaintingSwitcherConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.PistonConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.SignCopierConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.SpanConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.Unlock;
import java.util.List;
import java.util.Map;

/** Small configs for domain tests. */
public final class TestConfigs {

  private TestConfigs() {}

  public static Access access(int level) {
    return new Access(true, level, level);
  }

  public static SpanConfig span(int maxLength, int maxWidthEachSide) {
    return new SpanConfig(access(2), List.of(PLANKS, SPRUCE), maxLength, maxWidthEachSide);
  }

  /** Every feature on, bridges and doors up to 8 long and 1 wide each side, gates radius 3. */
  public static MechanicsConfig mechanics() {
    return new MechanicsConfig(
        new HiddenSwitchConfig(access(1)),
        new LightSwitchConfig(access(1), 8, 16, List.of("minecraft:candle")),
        new CookingPotConfig(access(1), List.of("minecraft:fire"), Map.of("minecraft:coal", 8), 64),
        new BlockDropsConfig(new Unlock(true, 1), List.of("minecraft:glass")),
        new ElevatorConfig(access(2), 64),
        span(8, 1),
        gate(3, 8, 8),
        span(8, 1),
        new SignCopierConfig(new Unlock(true, 3), "minecraft:feather"),
        new PaintingSwitcherConfig(new Unlock(true, 3)),
        new PistonConfig(
            new Unlock(true, 4),
            new Unlock(true, 4),
            new Unlock(true, 5),
            new Unlock(true, 5),
            1.5,
            8,
            4,
            12,
            List.of("minecraft:obsidian")),
        20);
  }

  public static GateConfig gate(int radius, int maxColumns, int maxHeight) {
    return new GateConfig(access(2), List.of(FENCE, SPRUCE_FENCE), radius, maxColumns, maxHeight);
  }
}
