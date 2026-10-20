package com.shepherdjerred.thestorm.creative.domain;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Predicate;

/** Who may claim a cell, and which nearby cell {@code /creative auto} may offer. */
public final class ClaimRules {

  /**
   * Rings searched around the player. The surveyed border is about 94 cells from center to edge.
   */
  public static final int SEARCH = 96;

  private ClaimRules() {}

  /** Empty when the claim is allowed. */
  public static Optional<ClaimRefusal> refusal(ClaimRequest request) {
    if (request.standing().isEmpty()) {
      return Optional.of(ClaimRefusal.ROAD);
    }
    if (!request.insideBorder()) {
      return Optional.of(ClaimRefusal.OUTSIDE);
    }
    var owner = request.view().owner();
    if (owner.isPresent()) {
      var who = owner.orElseThrow();
      return Optional.of(who.equals(request.actor()) ? ClaimRefusal.ALREADY : ClaimRefusal.OWNED);
    }
    if (request.view().staffHeld()) {
      return Optional.of(ClaimRefusal.STAFF_HELD);
    }
    if (!request.staff() && request.countedClaims() >= request.cap()) {
      return Optional.of(ClaimRefusal.CAP);
    }
    return Optional.empty();
  }

  /** Player claims only. A restored or staff-assigned plot adds nothing. */
  public static int counted(UUID actor, List<PlotView> views) {
    var total = 0;
    for (var view : views) {
      if (view.countsTowardCap()
          && view.owner().isPresent()
          && view.owner().orElseThrow().equals(actor)) {
        total++;
      }
    }
    return total;
  }

  /**
   * Whether the whole footprint sits inside the world border. {@code diameter} is the border size.
   */
  public static boolean inside(PlotBounds bounds, double centerX, double centerZ, double diameter) {
    var half = diameter / 2.0;
    var west = centerX - half;
    var east = centerX + half;
    var north = centerZ - half;
    var south = centerZ + half;
    return bounds.minX() >= west
        && bounds.maxX() < east
        && bounds.minZ() >= north
        && bounds.maxZ() < south;
  }

  /**
   * The border and the free-cell test {@link #nearest} searches. A cell is offered only when {@code
   * free} accepts it and its footprint sits inside the border.
   */
  public record Area(
      PlotGrid grid, double centerX, double centerZ, double diameter, Predicate<PlotId> free) {}

  /**
   * The nearest free plot id inside the border, searching outward from the cell under {@code
   * (blockX, blockZ)}. Empty when none of the searched cells is free.
   */
  public static Optional<PlotId> nearest(Area area, int blockX, int blockZ) {
    var origin = area.grid().cellId(blockX, blockZ);
    for (var radius = 0; radius <= SEARCH; radius++) {
      var found = ring(area, origin, radius);
      if (found.isPresent()) {
        return found;
      }
    }
    return Optional.empty();
  }

  /**
   * A name or description a player may store. Empty when it is blank, too long, or has a newline.
   */
  public static boolean textFits(String text, int max) {
    if (text.isBlank() || text.length() > max) {
      return false;
    }
    return text.indexOf('\n') < 0 && text.indexOf('\r') < 0;
  }

  private static Optional<PlotId> ring(Area area, PlotId origin, int radius) {
    for (var dx = -radius; dx <= radius; dx++) {
      for (var dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) != radius) {
          continue;
        }
        var id = new PlotId(origin.x() + dx, origin.z() + dz);
        if (inside(area.grid().bounds(id), area.centerX(), area.centerZ(), area.diameter())
            && area.free().test(id)) {
          return Optional.of(id);
        }
      }
    }
    return Optional.empty();
  }
}
