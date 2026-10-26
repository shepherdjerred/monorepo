package com.shepherdjerred.thestorm.creative.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Shipped claim rules: cap, restored plots, staff exemption, and staff-held refusal. */
final class ClaimRulesTest {

  private static final UUID ACTOR = UUID.fromString("00000000-0000-0000-0000-000000000001");
  private static final UUID OTHER = UUID.fromString("00000000-0000-0000-0000-000000000002");

  @Test
  void claimsAndAutomaticSelectionRespectTheWholeCircularFootprint() {
    var grid = PlotGrid.recovered();
    assertThat(ClaimRules.inside(grid.bounds(new PlotId(10, 10)), 0, 0, 3000)).isTrue();
    assertThat(ClaimRules.inside(grid.bounds(new PlotId(15, 15)), 0, 0, 3000))
        .as("the square corner is outside the circle")
        .isFalse();
    assertThat(ClaimRules.inside(grid.bounds(new PlotId(12, 12)), 0, 0, 3000))
        .as("a plot crossing the circle cannot be claimed")
        .isFalse();
    var nearest = ClaimRules.nearest(new ClaimRules.Area(grid, 0, 0, 3000, id -> true), 1300, 1300);
    assertThat(nearest)
        .hasValueSatisfying(
            id -> assertThat(ClaimRules.inside(grid.bounds(id), 0, 0, 3000)).isTrue());
  }

  @Test
  @DisplayName("empty cell")
  void emptyCell() {
    var cell = empty(new PlotId(4, 4));

    assertThat(ClaimRules.refusal(attempt(cell, false, 0, 2))).as("empty cell").isEmpty();
  }

  @Test
  @DisplayName("restored plot")
  void restoredPlot() {
    var restored =
        PlotViews.resolve(
            new PlotId(2, 1),
            Optional.of(new RecoveredPlot("2;1", ACTOR.toString(), List.of())),
            Optional.empty());

    assertThat(restored.countsTowardCap()).isFalse();
    assertThat(restored.owner()).contains(ACTOR);
    assertThat(ClaimRules.counted(ACTOR, List.of(restored))).as("restored plot").isZero();
    assertThat(ClaimRules.refusal(attempt(empty(new PlotId(4, 4)), false, 0, 2))).isEmpty();
  }

  @Test
  @DisplayName("second new claim past the cap")
  void secondNewClaimPastTheCap() {
    var cell = empty(new PlotId(5, 5));

    assertThat(ClaimRules.refusal(attempt(cell, false, 1, 2))).isEmpty();
    assertThat(ClaimRules.refusal(attempt(cell, false, 2, 2)))
        .as("second new claim past the cap")
        .contains(ClaimRefusal.CAP);
  }

  @Test
  @DisplayName("staff exemption")
  void staffExemption() {
    assertThat(ClaimRules.refusal(attempt(empty(new PlotId(6, 6)), true, 9, 2)))
        .as("staff exemption")
        .isEmpty();
  }

  @Test
  @DisplayName("staff-held refusal")
  void staffHeldRefusal() {
    var held =
        PlotViews.resolve(
            new PlotId(0, 0),
            Optional.of(new RecoveredPlot("0;0", "", List.of())),
            Optional.empty());

    assertThat(held.staffHeld()).isTrue();
    assertThat(ClaimRules.refusal(attempt(held, true, 0, 2)))
        .as("staff-held refusal")
        .contains(ClaimRefusal.STAFF_HELD);
    assertThat(ClaimRules.refusal(attempt(held, false, 0, 2))).contains(ClaimRefusal.STAFF_HELD);
  }

  @Test
  void aRoadAnOwnedPlotAndARepeatClaimAreRefused() {
    var standing = empty(new PlotId(1, 1));
    var onRoad = new ClaimRequest(ACTOR, false, true, Optional.empty(), standing, 0, 2);
    var owned = view(new PlotId(2, 2), Optional.of(OTHER), false, false);
    var already = view(new PlotId(3, 3), Optional.of(ACTOR), false, true);

    assertThat(ClaimRules.refusal(onRoad)).contains(ClaimRefusal.ROAD);
    assertThat(ClaimRules.refusal(attempt(owned, true, 0, 2))).contains(ClaimRefusal.OWNED);
    assertThat(ClaimRules.refusal(attempt(already, false, 0, 2))).contains(ClaimRefusal.ALREADY);
    assertThat(
            ClaimRules.refusal(
                new ClaimRequest(ACTOR, false, false, Optional.of(standing.id()), standing, 0, 2)))
        .contains(ClaimRefusal.OUTSIDE);
  }

  @Test
  void countedClaimsIgnoreCatalogRowsAndAReleasedPlot() {
    var playerClaim = view(new PlotId(8, 8), Optional.of(ACTOR), false, true);
    var assigned = view(new PlotId(8, 9), Optional.of(ACTOR), false, false);
    var released =
        PlotViews.resolve(
            new PlotId(2, 1),
            Optional.of(new RecoveredPlot("2;1", ACTOR.toString(), List.of())),
            Optional.of(
                new StoredClaim(
                    new PlotId(2, 1), Optional.empty(), true, false, "", "", Set.of())));

    assertThat(released.owner()).isEmpty();
    assertThat(ClaimRules.counted(ACTOR, List.of(playerClaim, assigned, released))).isEqualTo(1);
  }

  private static PlotView empty(PlotId id) {
    return view(id, Optional.empty(), false, false);
  }

  private static PlotView view(PlotId id, Optional<UUID> owner, boolean staffHeld, boolean counts) {
    return new PlotView(id, owner, "Harbor", "A dock", Set.of(), staffHeld, counts);
  }

  private static ClaimRequest attempt(PlotView view, boolean staff, int counted, int cap) {
    return new ClaimRequest(ACTOR, staff, true, Optional.of(view.id()), view, counted, cap);
  }
}
