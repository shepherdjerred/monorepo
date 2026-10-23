package com.shepherdjerred.thestorm.creative.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

final class EditDecisionTest {

  private static final UUID OWNER = UUID.fromString("00000000-0000-0000-0000-000000000001");
  private static final UUID FRIEND = UUID.fromString("00000000-0000-0000-0000-000000000002");
  private static final UUID STRANGER = UUID.fromString("00000000-0000-0000-0000-000000000003");

  private final PlotBounds plot = PlotGrid.recovered().bounds(new PlotId(1, 1));

  @Test
  void onlyTheOwnerMembersAndTrustedPlayersMayEdit() {
    var trusted = Map.of(FRIEND, PlotRole.TRUSTED);
    var member = Map.of(FRIEND, PlotRole.MEMBER);
    var denied = Map.of(STRANGER, PlotRole.DENIED);

    assertThat(EditDecision.mayEdit(OWNER, Optional.of(OWNER), trusted)).isTrue();
    assertThat(EditDecision.mayEdit(FRIEND, Optional.of(OWNER), trusted)).isTrue();
    assertThat(EditDecision.mayEdit(FRIEND, Optional.of(OWNER), member)).isTrue();
    assertThat(EditDecision.mayEdit(STRANGER, Optional.of(OWNER), trusted)).isFalse();
    assertThat(EditDecision.mayEdit(STRANGER, Optional.of(OWNER), denied)).isFalse();
    assertThat(EditDecision.mayEdit(FRIEND, Optional.empty(), trusted)).isFalse();
    assertThat(EditDecision.mayEdit(OWNER, Optional.empty(), Map.of())).isFalse();
    assertThat(PlotRole.mayEnter(false, denied, STRANGER)).isFalse();
    assertThat(PlotRole.mayEnter(false, denied, FRIEND)).isTrue();
    assertThat(PlotRole.mayEnter(true, denied, STRANGER)).isTrue();
  }

  @Test
  void aSelectionMustStayInsideOnePlotColumn() {
    assertThat(EditDecision.selectionFits(plot, new BlockBox(5, 64, 5, 86, 64, 86), -64, 319))
        .isTrue();
    assertThat(EditDecision.selectionFits(plot, new BlockBox(5, -64, 5, 86, 319, 86), -64, 319))
        .isTrue();
    assertThat(EditDecision.selectionFits(plot, new BlockBox(5, 64, 5, 87, 64, 6), -64, 319))
        .isFalse();
    assertThat(EditDecision.selectionFits(plot, new BlockBox(4, 64, 5, 6, 64, 6), -64, 319))
        .isFalse();
    assertThat(EditDecision.selectionFits(plot, new BlockBox(5, -64, 5, 86, 320, 86), -64, 319))
        .isFalse();
    assertThatThrownBy(() -> new BlockBox(2, 0, 0, 1, 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void deniedWorldEditCommandsIgnoreSlashesAndAPluginPrefix() {
    assertThat(EditDecision.blockedCommand("//regen")).isTrue();
    assertThat(EditDecision.blockedCommand("/worldedit:regen stone")).isTrue();
    assertThat(EditDecision.blockedCommand("WorldEdit:DELCHUNKS")).isTrue();
    assertThat(EditDecision.blockedCommand("//set stone")).isFalse();
    assertThat(EditDecision.blockedCommand("/creative claim")).isFalse();
    assertThat(EditDecision.brushFits(8, 8)).isTrue();
    assertThat(EditDecision.brushFits(9, 8)).isFalse();
  }

  @Test
  @DisplayName("road mask")
  void roadMask() {
    var grid = PlotGrid.recovered();

    assertThat(EditDecision.onRoad(Optional.empty())).as("road mask").isTrue();
    assertThat(EditDecision.mask(grid, Optional.empty(), true)).isEmpty();
    assertThat(EditDecision.mask(grid, Optional.of(new PlotId(1, 1)), false)).isEmpty();
    assertThat(EditDecision.mask(grid, Optional.of(new PlotId(1, 1)), true)).contains(plot);
  }

  @Test
  @DisplayName("one-block-onto-the-road refusal")
  void oneBlockOntoTheRoad() {
    assertThat(EditDecision.selectionFits(plot, new BlockBox(5, 64, 5, 87, 64, 6), -64, 319))
        .as("one-block-onto-the-road refusal")
        .isFalse();
  }

  @Test
  @DisplayName("a column one block too tall")
  void columnOneBlockTooTall() {
    assertThat(EditDecision.selectionFits(plot, new BlockBox(5, -64, 5, 86, 320, 86), -64, 319))
        .as("a column one block too tall")
        .isFalse();
  }

  @Test
  @DisplayName("a denied command")
  void deniedCommand() {
    assertThat(EditDecision.blockedCommand("//regen")).as("a denied command").isTrue();
    assertThat(EditDecision.blockedCommand("//set stone")).isFalse();
  }

  @Test
  @DisplayName("a brush over the cap")
  void brushOverTheCap() {
    assertThat(EditDecision.brushFits(9, 8)).as("a brush over the cap").isFalse();
    assertThat(EditDecision.brushFits(8, 8)).isTrue();
    assertThat(EditDecision.commandedBrushRadius("//size 9")).hasValue(9);
    assertThat(EditDecision.commandedBrushRadius("worldedit:/brush sphere stone 9")).hasValue(9);
  }

  @Test
  @DisplayName("a worldedit command is stopped before it runs")
  void worldEditCommandIsRecognizedBeforeItRuns() {
    assertThat(EditDecision.worldEditCommand("//set stone")).isTrue();
    assertThat(EditDecision.worldEditCommand("/worldedit:/set stone")).isTrue();
    assertThat(EditDecision.worldEditCommand("/worldedit:/regen")).isTrue();
    assertThat(EditDecision.worldEditCommand("/we:set stone")).isTrue();
    assertThat(EditDecision.worldEditCommand("/creative claim")).isFalse();
    assertThat(EditDecision.editsWorld("//set stone")).isTrue();
    assertThat(EditDecision.editsWorld("worldedit:/regen")).isTrue();
    assertThat(EditDecision.editsWorld("//pos1")).isFalse();
    assertThat(EditDecision.editsWorld("/worldedit:/pos2 87,64,-231")).isFalse();
    assertThat(EditDecision.editsWorld("//limit 10")).isFalse();
  }
}
