package com.shepherdjerred.thestorm.creative.domain;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Who may change a creative column. Staff bypass sits here, not in {@link EditDecision}, because a
 * WorldEdit mask and a broken block are different decisions. Roads and plots with no owner stay
 * closed to players.
 */
public final class PlotAccess {

  private static final Set<String> FORBIDDEN =
      Set.of(
          "minecraft:command_block",
          "minecraft:chain_command_block",
          "minecraft:repeating_command_block",
          "minecraft:structure_block",
          "minecraft:jigsaw",
          "minecraft:command_block_minecart");

  private PlotAccess() {}

  /**
   * Whether {@code actor} may break, place, or use this column. {@code plot} is empty on a road.
   * Staff may change any column. A plot with no owner is closed.
   */
  public static boolean mayChange(
      boolean staff, Optional<UUID> actor, Optional<PlotId> plot, PlotMembership membership) {
    if (staff) {
      return true;
    }
    if (plot.isEmpty() || actor.isEmpty()) {
      return false;
    }
    var id = plot.orElseThrow();
    var who = actor.orElseThrow();
    var owner = membership.owner(id);
    if (owner.isEmpty()) {
      return false;
    }
    return owner.orElseThrow().equals(who) || PlotRole.builds(membership.access(id), who);
  }

  /**
   * Whether every column is the same plot. A road, or two plots, refuses the whole piston, fluid,
   * or explosion. An empty list has nothing to refuse.
   */
  public static boolean staysInsideOnePlot(List<Optional<PlotId>> columns) {
    if (columns.isEmpty()) {
      return true;
    }
    var first = columns.getFirst();
    if (first.isEmpty()) {
      return false;
    }
    for (var column : columns) {
      if (!first.equals(column)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Whether one more entity may appear here. Staff are not capped. Roads take no entities. {@code
   * present} is the count already in the plot, players excluded.
   */
  public static boolean maySpawn(boolean staff, Optional<PlotId> plot, int present, int cap) {
    if (staff) {
      return true;
    }
    if (plot.isEmpty() || present < 0 || cap < 1) {
      return false;
    }
    return present < cap;
  }

  /** Command blocks, structure blocks, jigsaws, and command minecarts. Keys are namespaced ids. */
  public static boolean forbiddenPlacement(String key) {
    return FORBIDDEN.contains(key);
  }
}
