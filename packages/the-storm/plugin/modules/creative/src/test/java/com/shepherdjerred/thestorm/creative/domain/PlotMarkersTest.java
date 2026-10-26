package com.shepherdjerred.thestorm.creative.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
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
  @DisplayName("a named plot is labelled with that name")
  void aNamedPlotIsLabelledWithThatName() {
    var view = view(new PlotId(2, 1), Optional.of(OWNER), "Harbor", false);

    var markers = markers(List.of(view), Map.of(view.id(), "BenTheGamer78"));

    assertThat(markers).hasSize(1);
    assertThat(markers.getFirst().label()).isEqualTo("Harbor");
  }

  @Test
  @DisplayName("an unnamed plot uses the owner's username")
  void anUnnamedPlotUsesTheOwnersUsername() {
    var view = view(new PlotId(2, 1), Optional.of(OWNER), "", false);

    var markers = markers(List.of(view), Map.of(view.id(), "BenTheGamer78"));

    assertThat(markers.getFirst().label()).isEqualTo("BenTheGamer78");
  }

  @Test
  @DisplayName("a named staff-held plot keeps its name")
  void aNamedStaffHeldPlotKeepsItsName() {
    var view = view(new PlotId(0, 0), Optional.empty(), "Ruins", true);

    var markers = markers(List.of(view), Map.of());

    assertThat(markers.getFirst().label()).isEqualTo("Ruins");
  }

  @Test
  @DisplayName("an unnamed plot with no username reads staff")
  void anUnnamedPlotWithNoUsernameReadsStaff() {
    var view = view(new PlotId(0, 0), Optional.empty(), "", true);

    var markers = markers(List.of(view), Map.of());

    assertThat(markers.getFirst().label()).isEqualTo("staff");
  }

  @Test
  @DisplayName("a current username replaces the claim-sign name")
  void aCurrentUsernameReplacesTheClaimSignName() {
    var id = new PlotId(2, 1);
    var view = view(id, Optional.of(OWNER), "", false);
    var signed = Map.of(id, "OldName");

    var names = PlotMarkers.usernames(List.of(view), signed, Map.of(OWNER, "BenTheGamer78"));

    assertThat(names).containsEntry(id, "BenTheGamer78");
    assertThat(markers(List.of(view), names))
        .extracting(PlotMarker::label)
        .containsExactly("BenTheGamer78");
  }

  @Test
  @DisplayName("a claim sign names a plot the directory does not")
  void aClaimSignNamesAPlotTheDirectoryDoesNot() {
    var plot =
        new RecoveredPlot(
            "2;1",
            OWNER.toString(),
            List.of(
                new RecoveredPlot.Sign(1, 65, 1, List.of("tree", "", "", "")),
                new RecoveredPlot.Sign(
                    2, 65, 2, List.of("ID: 2;1", "Owner:", "BenTheGamer78", "Claimed")),
                new RecoveredPlot.Sign(3, 65, 3, List.of("Owner:", "LibraryAddict", "", ""))));
    var id = plot.plotId();
    var view = view(id, Optional.of(OWNER), "", false);

    assertThat(plot.signedOwner()).contains("BenTheGamer78");
    var names =
        PlotMarkers.usernames(List.of(view), PlotMarkers.signedNames(List.of(plot)), Map.of());

    assertThat(names).containsEntry(id, "BenTheGamer78");
  }

  @Test
  @DisplayName("empty cell")
  void emptyCell() {
    var empty = view(new PlotId(9, 9), Optional.empty(), "", false);

    assertThat(empty.marked()).isFalse();
    assertThat(markers(List.of(empty), Map.of())).as("empty cell").isEmpty();
  }

  @Test
  @DisplayName("selection is not applied to a survival map")
  void selectionIsNotAppliedToASurvivalMap() {
    var view = view(new PlotId(2, 1), Optional.of(OWNER), "Harbor", false);

    assertThat(PlotMarkers.select("world", "creative", List.of(view), GRID))
        .as("selection is not applied to a survival map")
        .isEmpty();
  }

  private static List<PlotMarker> markers(List<PlotView> views, Map<PlotId, String> usernames) {
    return PlotMarkers.select(
        "creative", "creative", PlotMarkers.presented(views, usernames), GRID);
  }

  private static PlotView view(PlotId id, Optional<UUID> owner, String name, boolean staffHeld) {
    return new PlotView(
        id, owner, name, "", Map.of(), staffHeld, false, Set.of(), PlotSurface.DEFAULT);
  }
}
