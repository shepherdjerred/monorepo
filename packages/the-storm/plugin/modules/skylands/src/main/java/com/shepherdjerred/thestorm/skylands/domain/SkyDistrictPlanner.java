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
              "skylands:square",
              new SkyPosition(7, 5, 7),
              new SkyPosition(3, 1, 3),
              List.of(),
              0,
              List.of());
      var root = search.find(new SkySiteSearch.Request(square, center(), 144, 120), List.of(), 240);
      if (root.isEmpty()) return SkyPlan.empty(cell, kind);
      var probe = root.orElseThrow().origin();
      var climate = new LayeredClimate(landscape.seed());
      var family =
          SkyVillagePalette.family(
              climate.biome(probe.above(1), terrain.column(probe.x(), probe.z())));
      var palette = new SkyVillagePalette(List.copyOf(templates.values()), landscape.seed());
      var center = villageCenter(palette.centers(family, cell), probe);
      if (center.isEmpty()) return SkyPlan.empty(cell, kind);
      var plaza = center.orElseThrow();
      pieces.add(plaza);
      exits();
      if (network.isEmpty()) return SkyPlan.empty(cell, kind);
      for (var building : palette.buildings(family, cell)) {
        if (pieces.size() >= 17) break;
        addPlot(building.key(), plaza.entrance(), 58, List.of());
      }
      if (pieces.size() < 10
          || residents().stream().filter(r -> r.kind() == SkyPlan.ResidentKind.VILLAGER).count() < 8
          || pieces.stream().noneMatch(p -> p.template().key().contains("farm"))) {
        return SkyPlan.empty(cell, kind);
      }
      return finish();
    }

    private java.util.Optional<SkyPiece> villageCenter(
        List<SkyTemplate> choices, SkyPosition near) {
      for (var template : choices) {
        var found = search.find(new SkySiteSearch.Request(template, near, 40, 12), List.of(), 160);
        if (found.isPresent()) return found;
      }
      return java.util.Optional.empty();
    }

    SkyPlan city() {
      var assembly = cityCenter();
      if (assembly.size() < 4 || SkyAssembly.centerWalls(assembly) < 3)
        return SkyPlan.empty(cell, kind);
      pieces.addAll(assembly);
      var core = pieces.getFirst();
      exits();
      if (network.isEmpty()) return SkyPlan.empty(cell, kind);
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
      for (var name :
          List.of(
              "large_pillar_1",
              "small_ruin_1",
              "medium_pillar_1",
              "camp_1",
              "small_ruin_2",
              "tall_ruin_3",
              "camp_2",
              "large_ruin_1"))
        addPlot(CITY + "structures/" + name, core.entrance(), 110, List.of());
      for (var name :
          List.of(
              "intact_horizontal_wall_stairs_1",
              "ruined_horizontal_wall_stairs_2",
              "ruined_corner_wall_1"))
        addPlot(CITY + "walls/" + name, core.entrance(), 112, List.of());
      for (var round = 0; round < 2; round++) {
        for (var name :
            List.of(
                "small_ruin_1", "small_ruin_2", "medium_ruin_1", "small_statue", "medium_pillar_1"))
          addPlot(CITY + "structures/" + name, core.entrance(), 112, List.of());
      }
      if (pieces.size() < 12 || !sculkCourt(core)) return SkyPlan.empty(cell, kind);
      return finish();
    }

    private List<SkyPiece> cityCenter() {
      var best = List.<SkyPiece>of();
      var assembly =
          new SkyAssembly(
              terrain,
              List.copyOf(templates.values()),
              cell.interior(),
              cell.seed(landscape.seed()));
      for (var attempt = 0; attempt < 8; attempt++) {
        var found =
            search.find(
                new SkySiteSearch.Request(
                    template(CITY + "city_center/city_center_1"), center().above(-40), 144, 90),
                List.of(),
                720);
        if (found.isEmpty()) break;
        var candidate = assembly.grow(found.orElseThrow());
        if (SkyAssembly.centerWalls(candidate) * 100 + candidate.size()
            > SkyAssembly.centerWalls(best) * 100 + best.size()) best = candidate;
        if (SkyAssembly.centerWalls(best) == 4 && best.size() >= 8) break;
      }
      return best;
    }

    private void exits() {
      for (var piece : pieces) {
        for (var join : piece.template().joins()) {
          if (join.direction().y() != 0) continue;
          var p = piece.at(join.position()).add(piece.direction(join.direction()));
          p = p.above(kind == SkyCell.Kind.ANCIENT_CITY ? 1 : Math.max(0, 1 - join.position().y()));
          var point = p;
          if (pieces.stream().noneMatch(other -> other.bounds().contains(point))
              && terrain.footing(p.above(-1), 3)) network.add(p);
        }
      }
    }

    private boolean sculkCourt(SkyPiece core) {
      var shape =
          new SkyTemplate(
              "skylands:sculk_court",
              new SkyPosition(9, 6, 9),
              new SkyPosition(-1, 1, 4),
              List.of(),
              0,
              List.of());
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
        sculkFloor(court);
        return true;
      }
      return false;
    }

    private void sculkFloor(SkyPiece court) {
      for (var x = 0; x < 9; x++) {
        for (var z = 0; z < 9; z++) {
          var p = courtFloor(court, x, z);
          if ((x - 4) * (x - 4) + (z - 4) * (z - 4)
              <= 17 + 5 * SkyRandom.noise(p.x() / 7.0, 0, p.z() / 7.0, landscape.seed() + 2897))
            edits.set(p, "sculk");
        }
      }
      edits.set(courtFloor(court, 4, 4).above(1), "sculk_shrieker[can_summon=true]");
      edits.set(courtFloor(court, 2, 4).above(1), "sculk_sensor");
      edits.set(courtFloor(court, 6, 4).above(1), "sculk_sensor");
      edits.set(courtFloor(court, 4, 7).above(1), "sculk_catalyst");
    }

    private SkyPosition courtFloor(SkyPiece court, int x, int z) {
      var p = court.at(new SkyPosition(x, 0, z));
      var y =
          terrain.column(p.x(), p.z()).surfaces(p.y() - 3, p.y()).stream()
              .mapToInt(Integer::intValue)
              .max()
              .orElseThrow();
      return new SkyPosition(p.x(), y, p.z());
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

    private SkyPlan finish() {
      for (var piece : pieces) {
        edits.foundation(piece, terrain);
        edits.workshops(piece);
        edits.farmLights(piece);
      }
      new SkyRouteGeometry(edits, terrain, pieces).apply(routes, kind == SkyCell.Kind.ANCIENT_CITY);
      new SkyAtmosphere(terrain, edits, cell).apply(pieces, kind == SkyCell.Kind.ANCIENT_CITY);
      var residents = kind == SkyCell.Kind.VILLAGE ? residents() : List.<SkyPlan.Resident>of();
      return new SkyPlan(cell, kind, pieces, edits.finish(), residents);
    }

    private List<SkyPlan.Resident> residents() {
      var residents =
          new ArrayList<>(
              pieces.stream()
                  .flatMap(p -> p.template().residents().stream().map(p::at))
                  .limit(18)
                  .map(p -> new SkyPlan.Resident(p, SkyPlan.ResidentKind.VILLAGER))
                  .toList());
      for (var piece : pieces) {
        for (var join : piece.template().joins()) {
          var type = nativeResident(join.pool());
          if (type.isPresent())
            residents.add(
                new SkyPlan.Resident(piece.at(join.position()).above(1), type.orElseThrow()));
        }
      }
      return List.copyOf(residents);
    }

    private java.util.Optional<SkyPlan.ResidentKind> nativeResident(String pool) {
      return switch (pool) {
        case "minecraft:village/common/iron_golem" ->
            java.util.Optional.of(SkyPlan.ResidentKind.IRON_GOLEM);
        case "minecraft:village/common/cats" -> java.util.Optional.of(SkyPlan.ResidentKind.CAT);
        case "minecraft:village/common/animals" -> java.util.Optional.of(SkyPlan.ResidentKind.COW);
        case "minecraft:village/common/sheep" -> java.util.Optional.of(SkyPlan.ResidentKind.SHEEP);
        case "minecraft:village/common/horses" -> java.util.Optional.of(SkyPlan.ResidentKind.HORSE);
        default -> java.util.Optional.empty();
      };
    }
  }
}
