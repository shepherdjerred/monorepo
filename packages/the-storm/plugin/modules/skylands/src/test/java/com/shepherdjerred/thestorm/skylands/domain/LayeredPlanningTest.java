package com.shepherdjerred.thestorm.skylands.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;

final class LayeredPlanningTest {
  record Geometry(List<SkyTemplate> templates) {}

  private static List<SkyTemplate> templates() throws IOException {
    return StrictYaml.parse(
            "native-template-geometry.json",
            Files.readString(Path.of("src/test/resources/native-template-geometry.json")),
            Geometry.class)
        .fold(
            Geometry::templates,
            problems -> {
              throw new AssertionError(problems);
            });
  }

  @Test
  void negativeChunksHaveDisjointCellOwnership() {
    assertThat(SkyCell.atChunk(-1, -32)).isEqualTo(new SkyCell(-1, -1));
    assertThat(SkyCell.atChunk(-33, 32)).isEqualTo(new SkyCell(-2, 1));
    var cell = new SkyCell(-1, -1);
    assertThat(cell.interior().intersects(new SkyCell(0, -1).interior())).isFalse();
    assertThat(cell.interior().intersects(new SkyCell(-1, 0).interior())).isFalse();
  }

  @Test
  void completeDistrictsFitActualShelvesAndLeaveBuildingsClearOfRoutes() throws IOException {
    var land = new LayeredLandscape(90210);
    var sites = new LayeredSites(land, templates());
    var fit = new PlotFit(new TerrainWindow(land));
    for (var cell : List.of(new SkyCell(18, -23), new SkyCell(17, -23))) {
      var plan = sites.plan(cell);
      assertThat(plan.pieces()).hasSizeGreaterThanOrEqualTo(10);
      for (var piece : plan.pieces()) {
        assertThat(fit.fits(piece)).as("terrain fit: %s", piece).isTrue();
        assertThat(
                plan.pieces().stream()
                    .filter(p -> !p.equals(piece))
                    .noneMatch(p -> p.bounds().intersects(piece.bounds())))
            .isTrue();
        assertThat(
                plan.edits().stream()
                    .filter(e -> e.block().equals("minecraft:air"))
                    .noneMatch(e -> piece.bounds().contains(e.position())))
            .as("routes must not cut a later plot: %s", piece)
            .isTrue();
      }
    }
    var village = sites.plan(new SkyCell(18, -23));
    assertThat(
            village.residents().stream()
                .filter(r -> r.kind() == SkyPlan.ResidentKind.VILLAGER)
                .count())
        .isGreaterThanOrEqualTo(8);
    assertThat(village.pieces()).anyMatch(p -> p.template().key().contains("/town_centers/"));
    assertThat(village.residents()).anyMatch(r -> r.kind() == SkyPlan.ResidentKind.IRON_GOLEM);
    assertThat(village.pieces()).anyMatch(p -> p.template().key().contains("farm"));
    assertThat(sites.plan(new SkyCell(17, -23)).edits())
        .anyMatch(e -> e.block().equals("minecraft:sculk_shrieker[can_summon=true]"));
    var walls =
        sites.plan(new SkyCell(17, -23)).pieces().stream()
            .filter(p -> p.template().key().contains("city_center/"))
            .toList();
    assertThat(walls).hasSizeGreaterThanOrEqualTo(4);
    var connected = new java.util.HashSet<SkyPiece>();
    connected.add(walls.getFirst());
    for (var round = 0; round < walls.size(); round++) {
      for (var child : walls) {
        if (connected.stream().anyMatch(parent -> joined(parent, child))) connected.add(child);
      }
    }
    assertThat(connected).containsExactlyInAnyOrderElementsOf(walls);
  }

  private static boolean joined(SkyPiece parent, SkyPiece child) {
    return parent.template().joins().stream()
        .anyMatch(
            a ->
                child.template().joins().stream()
                    .anyMatch(
                        b ->
                            a.target().equals(b.name())
                                && parent
                                    .at(a.position())
                                    .add(parent.direction(a.direction()))
                                    .equals(child.at(b.position()))
                                && parent
                                    .direction(a.direction())
                                    .add(child.direction(b.direction()))
                                    .equals(new SkyPosition(0, 0, 0))));
  }

  @Test
  void planningOrderAndConcurrentRequestsDoNotChangeTheLayout() throws Exception {
    var cells = List.of(new SkyCell(18, -23), new SkyCell(16, -22), new SkyCell(17, -23));
    var forward = new LayeredSites(new LayeredLandscape(90210), templates());
    var expected = cells.stream().map(forward::plan).toList();
    var reverse = new LayeredSites(new LayeredLandscape(90210), templates());
    for (var i = cells.size() - 1; i >= 0; i--) {
      assertThat(reverse.plan(cells.get(i))).isEqualTo(expected.get(i));
    }
    var concurrent = new LayeredSites(new LayeredLandscape(90210), templates());
    var tasks = cells.stream().map(c -> (Callable<SkyPlan>) () -> concurrent.plan(c)).toList();
    try (var pool = Executors.newFixedThreadPool(3)) {
      var results = pool.invokeAll(tasks);
      for (var i = 0; i < results.size(); i++)
        assertThat(results.get(i).get()).isEqualTo(expected.get(i));
    }
    assertThat(
            expected.get(1).edits().stream()
                .filter(e -> e.block().startsWith("minecraft:rail["))
                .count())
        .isGreaterThanOrEqualTo(120);
  }

  @Test
  void plansRejectEditsResidentsAndPiecesOutsideTheirOwnCell() {
    var cell = new SkyCell(0, 0);
    var outside = new SkyPosition(-1, 100, 100);
    assertThatThrownBy(
            () ->
                new SkyPlan(
                    cell,
                    SkyCell.Kind.MINE,
                    List.of(),
                    List.of(new SkyPlan.Edit(outside, "minecraft:stone")),
                    List.of()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new SkyPlan(
                    cell,
                    SkyCell.Kind.VILLAGE,
                    List.of(),
                    List.of(),
                    List.of(new SkyPlan.Resident(outside, SkyPlan.ResidentKind.VILLAGER))))
        .isInstanceOf(IllegalArgumentException.class);
    var shape =
        new SkyTemplate(
            "test", new SkyPosition(3, 4, 5), new SkyPosition(0, 1, -1), List.of(), 0, List.of());
    assertThatThrownBy(
            () ->
                new SkyPlan(
                    cell,
                    SkyCell.Kind.VILLAGE,
                    List.of(new SkyPiece(shape, outside, 0)),
                    List.of(),
                    List.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
