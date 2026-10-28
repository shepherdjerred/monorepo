package com.shepherdjerred.thestorm.mechanics.domain.stargate;

import com.shepherdjerred.thestorm.mechanics.domain.grid.BlockGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Mount;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;

/** Checks the saved sign and structure against the blocks currently in the world. */
public final class StargateIntegrityRules {
  private StargateIntegrityRules() {}

  public record Inspection(
      BlockGrid grid,
      Stargate gate,
      StargateNetwork network,
      SignView sign,
      boolean buttonMatches) {}

  public static boolean valid(Inspection inspection, boolean open) {
    if (!structure(inspection)) return false;
    var grid = inspection.grid();
    var gate = inspection.gate();
    var expected = open ? "minecraft:nether_portal" : Cell.AIR;
    return gate.frame().interior().stream()
        .allMatch(pos -> grid.contains(pos) && grid.cellAt(pos).is(expected));
  }

  /** A crash can leave an incomplete portal; only air and portal blocks may be recovered. */
  public static boolean recoverable(Inspection inspection) {
    if (!structure(inspection)) return false;
    var grid = inspection.grid();
    var gate = inspection.gate();
    var interior = gate.frame().interior();
    return interior.stream()
            .allMatch(
                pos ->
                    grid.contains(pos)
                        && (grid.cellAt(pos).is(Cell.AIR)
                            || grid.cellAt(pos).is("minecraft:nether_portal")))
        && interior.stream().anyMatch(pos -> grid.cellAt(pos).is("minecraft:nether_portal"));
  }

  private static boolean structure(Inspection inspection) {
    var grid = inspection.grid();
    var gate = inspection.gate();
    var network = inspection.network();
    var sign = inspection.sign();
    if (sign.mount() != Mount.WALL
        || sign.facing().isEmpty()
        || sign.facing().orElseThrow() != gate.facing()
        || !sign.line(0).strip().equals(gate.name())
        || (gate.fixedDestination() != null
            && !sign.line(1).strip().equalsIgnoreCase(gate.fixedDestination()))
        || (gate.alwaysOpen() && !sign.line(3).strip().equalsIgnoreCase("A"))
        || !sign.line(2).strip().equalsIgnoreCase(network.name())
        || !inspection.buttonMatches()) return false;
    return gate.frame().frameBlocks().stream()
        .allMatch(pos -> grid.contains(pos) && grid.cellAt(pos).is("minecraft:obsidian"));
  }
}
