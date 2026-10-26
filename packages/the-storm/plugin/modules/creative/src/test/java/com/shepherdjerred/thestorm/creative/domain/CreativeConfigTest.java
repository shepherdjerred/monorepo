package com.shepherdjerred.thestorm.creative.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class CreativeConfigTest {

  private static final Path SHIPPED =
      Path.of("../../../server/owned/plugins/TheStorm/creative.yml");

  private static final String VALID =
      """
      world: creative
      plotWidth: 82
      roadWidth: 10
      roadOffsetX: 0
      roadOffsetZ: 0
      surfaceY: 64
      borderCenterX: 1280
      borderCenterZ: -768
      borderSize: 8704
      claimCap: 2
      entityCap: 200
      brushRadius: 8
      commentLength: 140
      commentCap: 20
      plots: []
      """;

  private static final String ONE_PLOT =
      """
      world: creative
      plotWidth: 82
      roadWidth: 10
      roadOffsetX: 0
      roadOffsetZ: 0
      surfaceY: 64
      borderCenterX: 1280
      borderCenterZ: -768
      borderSize: 8704
      claimCap: 2
      entityCap: 200
      brushRadius: 8
      commentLength: 140
      commentCap: 20
      plots:
        - id: "2;1"
          owner: "cb488c76-08ba-4755-b425-6613fde02f70"
          signs:
            - x: 97
              y: 65
              z: 4
              lines: ["ID: 2;1", "Owner:", "BenTheGamer78", "Claimed"]
      """;

  private static final String DUPLICATE =
      """
      world: creative
      plotWidth: 82
      roadWidth: 10
      roadOffsetX: 0
      roadOffsetZ: 0
      surfaceY: 64
      borderCenterX: 1280
      borderCenterZ: -768
      borderSize: 8704
      claimCap: 2
      entityCap: 200
      brushRadius: 8
      commentLength: 140
      commentCap: 20
      plots:
        - id: "2;1"
          owner: ""
          signs: []
        - id: "2;1"
          owner: "cb488c76-08ba-4755-b425-6613fde02f70"
          signs:
            - x: 97
              y: 65
              z: 4
              lines: ["ID: 2;1", "Owner:", "BenTheGamer78", "Claimed"]
      """;

  @Test
  void theOwnedFileMatchesTheRecoveredGrid() {
    var config = ConfigFiles.load(SHIPPED, CreativeConfig.class);

    assertThat(config.world()).isEqualTo("creative");
    assertThat(config.plotWidth()).isEqualTo(PlotGrid.PLOT_WIDTH);
    assertThat(config.roadWidth()).isEqualTo(PlotGrid.ROAD_WIDTH);
    assertThat(config.borderSize()).isEqualTo(3000);
    assertThat(config.borderCenterX()).isZero();
    assertThat(config.borderCenterZ()).isZero();
    assertThat(config.claimCap()).isEqualTo(2);
    assertThat(config.commentLength()).isEqualTo(140);
    assertThat(config.commentCap()).isEqualTo(20);
    assertThat(config.grid().size()).isEqualTo(92);
    assertThat(config.plots()).hasSize(215);
    assertThat(config.plots().stream().filter(plot -> !plot.owner().isEmpty())).hasSize(196);
    var catalog = config.catalog();
    assertThat(catalog.size()).isEqualTo(215);
    var ben = catalog.get(new PlotId(2, 1)).orElseThrow();
    assertThat(ben.ownerId()).contains(UUID.fromString("cb488c76-08ba-4755-b425-6613fde02f70"));
    assertThat(ben.signs().getFirst().lines())
        .containsExactly("ID: 2;1", "Owner:", "BenTheGamer78", "Claimed");
    assertThat(catalog.get(new PlotId(-1, 4)).orElseThrow().owner()).isEmpty();
    assertThat(catalog.get(new PlotId(-1, 4)).orElseThrow().signs().getFirst().lines())
        .contains("Brooters");
    assertThat(catalog.get(new PlotId(0, -2)).orElseThrow().owner()).isEmpty();
    assertThat(catalog.get(new PlotId(-6, -2)).orElseThrow().owner()).isEmpty();
    assertThat(catalog.get(new PlotId(0, 0)).orElseThrow().signs()).isEmpty();
  }

  @Test
  void aPlayableCircleIsIndependentOfArchiveExtentButInvalidBoundsAndGridAreRefused() {
    assertThat(StrictYaml.parse("creative.yml", VALID, CreativeConfig.class).isOk()).isTrue();
    assertThat(
            StrictYaml.parse(
                    "creative.yml",
                    VALID.replace("borderSize: 8704", "borderSize: 0"),
                    CreativeConfig.class)
                .isOk())
        .isFalse();
    assertThat(
            StrictYaml.parse(
                    "creative.yml",
                    VALID
                        .replace("borderCenterX: 1280", "borderCenterX: 0")
                        .replace("borderCenterZ: -768", "borderCenterZ: 0")
                        .replace("borderSize: 8704", "borderSize: 3000"),
                    CreativeConfig.class)
                .isOk())
        .isTrue();
    assertThat(
            StrictYaml.parse(
                    "creative.yml",
                    VALID.replace("borderSize: 8704", "borderSize: 60000000"),
                    CreativeConfig.class)
                .isOk())
        .isFalse();
    assertThat(
            StrictYaml.parse(
                    "creative.yml",
                    VALID.replace("borderSize: 8704", "borderSize: 10"),
                    CreativeConfig.class)
                .isOk())
        .isFalse();
    assertThat(
            StrictYaml.parse(
                    "creative.yml",
                    VALID.replace("plotWidth: 82", "plotWidth: 80"),
                    CreativeConfig.class)
                .isOk())
        .isFalse();
    assertThat(
            StrictYaml.parse(
                    "creative.yml",
                    VALID.replace("world: creative", "world: plots"),
                    CreativeConfig.class)
                .isOk())
        .isFalse();
    assertThat(
            StrictYaml.parse("creative.yml", VALID + "extra: true\n", CreativeConfig.class).isOk())
        .isFalse();
    assertThat(StrictYaml.parse("creative.yml", ONE_PLOT, CreativeConfig.class).isOk()).isTrue();
    assertThat(
            StrictYaml.parse(
                    "creative.yml",
                    ONE_PLOT.replace("cb488c76-08ba-4755-b425-6613fde02f70", "BenTheGamer78"),
                    CreativeConfig.class)
                .isOk())
        .isFalse();
    assertThat(StrictYaml.parse("creative.yml", DUPLICATE, CreativeConfig.class).isOk()).isFalse();
  }
}
