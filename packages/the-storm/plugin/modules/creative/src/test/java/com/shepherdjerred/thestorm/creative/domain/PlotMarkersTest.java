package com.shepherdjerred.thestorm.creative.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Shipped marker selection for the creative map only. */
final class PlotMarkersTest {

  private static final UUID OWNER = UUID.fromString("cb488c76-08ba-4755-b425-6613fde02f70");
  private static final PlotGrid GRID = PlotGrid.recovered();

  @Test
  @DisplayName("claimed plot")
  void claimedPlot() {
    var view =
        new PlotView(
            new PlotId(2, 1), Optional.of(OWNER), "Harbor", "A dock", Set.of(), false, true);

    var markers = PlotMarkers.select("creative", "creative", List.of(view), GRID);

    assertThat(markers).hasSize(1);
    assertThat(markers.getFirst().label())
        .as("claimed plot")
        .contains("2;1")
        .contains(OWNER.toString())
        .contains("Harbor")
        .contains("A dock");
  }

  @Test
  @DisplayName("staff-held plot")
  void staffHeldPlot() {
    var view =
        new PlotView(
            new PlotId(0, 0), Optional.empty(), "Ruins", "Unclaimed build", Set.of(), true, false);

    var markers = PlotMarkers.select("creative", "creative", List.of(view), GRID);

    assertThat(markers).hasSize(1);
    assertThat(markers.getFirst().label())
        .as("staff-held plot")
        .contains("0;0")
        .contains("staff")
        .contains("Ruins")
        .contains("Unclaimed build");
  }

  @Test
  @DisplayName("empty cell")
  void emptyCell() {
    var empty = new PlotView(new PlotId(9, 9), Optional.empty(), "", "", Set.of(), false, false);

    assertThat(empty.marked()).isFalse();
    assertThat(PlotMarkers.select("creative", "creative", List.of(empty), GRID))
        .as("empty cell")
        .isEmpty();
  }

  @Test
  @DisplayName("selection is not applied to a survival map")
  void selectionIsNotAppliedToASurvivalMap() {
    var view =
        new PlotView(
            new PlotId(2, 1), Optional.of(OWNER), "Harbor", "A dock", Set.of(), false, true);

    assertThat(PlotMarkers.select("world", "creative", List.of(view), GRID))
        .as("selection is not applied to a survival map")
        .isEmpty();
  }
}
