package com.shepherdjerred.thestorm.mechanics.domain;

import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.FENCE;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.PLANKS;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.SPRUCE;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.SPRUCE_FENCE;

import com.shepherdjerred.thestorm.mechanics.domain.config.Access;
import com.shepherdjerred.thestorm.mechanics.domain.config.GateConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.SpanConfig;
import java.util.List;

/** Small configs for domain tests. */
public final class TestConfigs {

  private TestConfigs() {}

  public static Access access(int level) {
    return new Access(true, level, level);
  }

  public static SpanConfig span(int maxLength, int maxWidthEachSide) {
    return new SpanConfig(access(2), List.of(PLANKS, SPRUCE), maxLength, maxWidthEachSide);
  }

  public static GateConfig gate(int radius, int maxColumns, int maxHeight) {
    return new GateConfig(access(2), List.of(FENCE, SPRUCE_FENCE), radius, maxColumns, maxHeight);
  }
}
