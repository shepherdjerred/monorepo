package com.shepherdjerred.thestorm.skylands.domain;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Villages and ancient ruins select every plot and connection from seed and original density. */
final class SkyDistrictPlanner {
  private static final String HOUSES = "village/plains/houses/";
  private static final String CITY = "ancient_city/";
  private final LayeredLandscape landscape;
  private final Map<String, SkyTemplate> templates;

  SkyDistrictPlanner(LayeredLandscape landscape, List<SkyTemplate> templates) {
    this.landscape = landscape;
    this.templates =
        templates.stream()
            .collect(Collectors.toUnmodifiableMap(SkyTemplate::key, Function.identity()));
  }

  SkyPlan plan(SkyCell cell) {
    var kind = cell.kind(landscape.seed());
    var state = new District(cell, kind);
    return kind == SkyCell.Kind.VILLAGE ? state.village() : state.city();
  }

  private final class District {
    private final SkyCell cell;
    private final SkyCell.Kind kind;
    private final TerrainWindow terrain = new TerrainWindow(landscape);
    private final List<SkyPiece> pieces = new ArrayList<>();
    private final List<SkyRoute> routes = new ArrayList<>();
    private final Set<SkyPosition> network = new LinkedHashSet<>();
    private final SkySiteSearch search;
    private final SkyEdits edits;

    District(SkyCell cell, SkyCell.Kind kind) {
      this.cell = cell;
      this.kind = kind;
      search = new SkySiteSearch(terrain, cell, cell.seed(landscape.seed()));
      edits = new SkyEdits(cell);
    }

    private SkyPosition center() {
      return cell.interior().min().add(new SkyPosition(160, 140 - LayeredLandscape.MIN_Y, 160));
    }

    SkyPlan village() {
      var square =
          new SkyTemplate(
              "skylands:square", new SkyPosition(7, 5, 7), new SkyPosition(3, 1, 3), List.of(), 0);
      var root = search.find(new SkySiteSearch.Request(square, center(), 144, 120), List.of(), 240);
      if (root.isEmpty()) return SkyPlan.empty(cell, kind);
      var plaza = root.orElseThrow();
      for (var x = 0; x < 7; x++) {
        for (var z = 0; z < 7; z++) network.add(plaza.at(new SkyPosition(x, 1, z)));
      }
      var names =
          List.of(
              "plains_big_house_1",
              "plains_medium_house_2",
              "plains_small_house_4",
              "plains_small_farm_1",
              "plains_library_2",
              "plains_small_house_6",
              "plains_small_house_3");
      for (var name : names) addPlot(HOUSES + name, plaza.entrance(), 42, List.of(plaza));
      if (pieces.size() < 5
          || pieces.stream().noneMatch(p -> p.template().key().contains("farm"))) {
        return SkyPlan.empty(cell, kind);
      }
      edits.foundation(plaza, terrain);
      for (var p : network) {
        if (p.x() >= plaza.origin().x()
            && p.x() < plaza.origin().x() + 7
            && p.z() >= plaza.origin().z()
            && p.z() < plaza.origin().z() + 7) {
          edits.set(p.above(-1), "gravel");
          for (var h = 0; h < 3; h++) edits.set(p.above(h), "air");
        }
      }
      squareDetails(plaza);
      return finish();
    }

    SkyPlan city() {
      var root =
          search.find(
              new SkySiteSearch.Request(
                  template(CITY + "city_center/city_center_1"), center().above(-40), 144, 90),
              List.of(),
              720);
      if (root.isEmpty()) return SkyPlan.empty(cell, kind);
      var core = root.orElseThrow();
      pieces.add(core);
      network.add(core.entrance());
      var names =
          List.of(
              "chamber_3",
              "barracks",
              "chamber_2",
              "ice_box_1",
              "tall_ruin_2",
              "medium_ruin_1",
              "chamber_1",
              "medium_ruin_2",
              "small_statue");
      for (var name : names) addPlot(CITY + "structures/" + name, core.entrance(), 96, List.of());
      if (pieces.size() < 4 || !sculkCourt(core)) return SkyPlan.empty(cell, kind);
      return finish();
    }

    private boolean sculkCourt(SkyPiece core) {
      var shape =
          new SkyTemplate(
              "skylands:sculk_court",
              new SkyPosition(9, 6, 9),
              new SkyPosition(-1, 1, 4),
              List.of(),
              0);
      for (var attempt = 0; attempt < 8; attempt++) {
        var found =
            search.find(new SkySiteSearch.Request(shape, core.entrance(), 72, 28), pieces, 64);
        if (found.isEmpty()) return false;
        var court = found.orElseThrow();
        if (occupiedByRoute(court)) continue;
        var reserved = new ArrayList<>(pieces);
        reserved.add(court);
        var route =
            new SkyRoutes(terrain, cell.interior(), reserved)
                .find(court.entrance(), network, SkyRoutes.Mode.RUINS);
        if (route.isEmpty()) continue;
        routes.add(route.orElseThrow());
        edits.foundation(court, terrain);
        sculkFloor(court);
        return true;
      }
      return false;
    }

    private void sculkFloor(SkyPiece court) {
      for (var x = 0; x < 9; x++) {
        for (var z = 0; z < 9; z++) {
          edits.set(court.at(new SkyPosition(x, 0, z)), "sculk");
          for (var y = 1; y < 6; y++) edits.set(court.at(new SkyPosition(x, y, z)), "air");
        }
      }
      edits.set(court.at(new SkyPosition(4, 1, 4)), "sculk_shrieker[can_summon=true]");
      edits.set(court.at(new SkyPosition(2, 1, 4)), "sculk_sensor");
      edits.set(court.at(new SkyPosition(6, 1, 4)), "sculk_sensor");
      edits.set(court.at(new SkyPosition(4, 1, 7)), "sculk_catalyst");
    }

    private SkyTemplate template(String key) {
      var found = templates.get(key);
      if (found == null) throw new IllegalArgumentException("Missing template geometry " + key);
      return found;
    }

    private void addPlot(String key, SkyPosition near, int radius, List<SkyPiece> reserved) {
      var blockers = new ArrayList<>(pieces);
      blockers.addAll(reserved);
      var request =
          new SkySiteSearch.Request(
              template(key), near, radius, kind == SkyCell.Kind.VILLAGE ? 12 : 28);
      for (var attempt = 0; attempt < 8; attempt++) {
        var candidate = search.find(request, blockers, 48);
        if (candidate.isEmpty()) return;
        var piece = candidate.orElseThrow();
        if (occupiedByRoute(piece)) continue;
        var all = new ArrayList<>(pieces);
        all.add(piece);
        var mode = kind == SkyCell.Kind.VILLAGE ? SkyRoutes.Mode.VILLAGE : SkyRoutes.Mode.RUINS;
        var route =
            new SkyRoutes(terrain, cell.interior(), all).find(piece.entrance(), network, mode);
        if (route.isPresent()) {
          pieces.add(piece);
          routes.add(route.orElseThrow());
          for (var edge : route.orElseThrow().segments())
            network.addAll(SkyRouteGeometry.points(edge));
          return;
        }
      }
    }

    private boolean occupiedByRoute(SkyPiece piece) {
      return network.stream()
              .anyMatch(p -> piece.bounds().contains(p) || piece.bounds().contains(p.above(2)))
          || routes.stream()
              .flatMap(r -> r.segments().stream())
              .anyMatch(e -> routeBounds(e).intersects(piece.bounds()));
    }

    private SkyBounds routeBounds(SkyRoute.Segment edge) {
      var a = edge.from();
      var b = edge.to();
      return new SkyBounds(
          new SkyPosition(
              Math.min(a.x(), b.x()), Math.min(a.y(), b.y()) - 1, Math.min(a.z(), b.z())),
          new SkyPosition(
              Math.max(a.x(), b.x()), Math.max(a.y(), b.y()) + 2, Math.max(a.z(), b.z())));
    }

    private void squareDetails(SkyPiece plaza) {
      var occupied =
          routes.stream()
              .flatMap(r -> r.segments().stream())
              .flatMap(e -> SkyRouteGeometry.points(e).stream())
              .collect(Collectors.toUnmodifiableSet());
      var free =
          network.stream()
              .filter(p -> !occupied.contains(p))
              .filter(p -> p.x() == plaza.origin().x() || p.z() == plaza.origin().z())
              .sorted(
                  java.util.Comparator.comparingInt(SkyPosition::x)
                      .thenComparingInt(SkyPosition::z))
              .toList();
      if (!free.isEmpty()) {
        edits.set(free.getFirst(), "stripped_oak_log[axis=y]");
        edits.set(free.getFirst().above(1), "bell[attachment=floor,facing=north]");
      }
      for (var i = 1; i < Math.min(4, free.size()); i++)
        edits.set(free.get(i), "oak_stairs[facing=south]");
    }

    private SkyPlan finish() {
      for (var piece : pieces) {
        edits.foundation(piece, terrain);
        edits.workshops(piece);
        edits.farmLights(piece);
      }
      new SkyRouteGeometry(edits, terrain, pieces).apply(routes, kind == SkyCell.Kind.ANCIENT_CITY);
      var residents = kind == SkyCell.Kind.VILLAGE ? residents() : List.<SkyPlan.Resident>of();
      return new SkyPlan(cell, kind, pieces, edits.finish(), residents);
    }

    private List<SkyPlan.Resident> residents() {
      return pieces.stream()
          .flatMap(p -> p.template().residents().stream().map(p::at))
          .limit(7)
          .map(p -> new SkyPlan.Resident(p, SkyPlan.ResidentKind.VILLAGER))
          .toList();
    }
  }
}
