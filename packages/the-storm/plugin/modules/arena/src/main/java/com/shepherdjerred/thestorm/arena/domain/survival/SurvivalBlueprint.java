package com.shepherdjerred.thestorm.arena.domain.survival;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import java.util.Map;

/** Selects an authored map explicitly; unknown map identifiers are configuration errors. */
public final class SurvivalBlueprint {
  private SurvivalBlueprint() {}

  public static Map<BlockPos, String> blocks(SurvivalContent content) {
    return switch (content.arena().id()) {
      case "settlement" -> new SettlementBlueprint(content).blocks();
      case "rustworks" -> new RustworksBlueprint(content).blocks();
      default -> throw new IllegalArgumentException("No blueprint for " + content.arena().id());
    };
  }

  public static int budget(SurvivalContent content) {
    return switch (content.arena().id()) {
      case "settlement" -> SettlementBlueprint.BLOCK_BUDGET;
      case "rustworks" -> RustworksBlueprint.BLOCK_BUDGET;
      default -> throw new IllegalArgumentException("No blueprint for " + content.arena().id());
    };
  }
}
