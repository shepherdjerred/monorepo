package com.shepherdjerred.thestorm.skylands.domain;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** A sparse branching working, generated from rock connectivity instead of an entrance fixture. */
final class SkyMinePlanner {
  record Mouth(SkyPosition outside, SkyPosition inside) {}

  private final LayeredLandscape landscape;

  SkyMinePlanner(LayeredLandscape landscape) {
    this.landscape = landscape;
  }

  SkyPlan plan(SkyCell cell) {
    var terrain = new TerrainWindow(landscape);
    var geology = new SkyMineTerrain(terrain, cell.interior());
    for (var attempt = 0; attempt < 8; attempt++) {
      var mouth = mouth(cell, terrain, geology, attempt);
      if (mouth.isEmpty()) continue;
      var result = new Working(cell, geology, mouth.orElseThrow()).finish();
      if (!result.edits().isEmpty()) return result;
    }
    return SkyPlan.empty(cell, SkyCell.Kind.MINE);
  }

  private Optional<Mouth> mouth(
      SkyCell cell, TerrainWindow terrain, SkyMineTerrain geology, int attempt) {
    var random = new Lcg48(cell.seed(landscape.seed()) + attempt * 2521L);
    var origin = cell.interior().min();
    for (var trial = 0; trial < 384; trial++) {
      int x = origin.x() + 24 + random.nextInt(376), z = origin.z() + 24 + random.nextInt(376);
      for (var surface : terrain.column(x, z).surfaces(45, 220)) {
        var result = mouthAt(new SkyPosition(x, surface + 1, z), geology);
        if (result.isPresent()) return result;
      }
    }
    return Optional.empty();
  }

  private static Optional<Mouth> mouthAt(SkyPosition surface, SkyMineTerrain geology) {
    for (var depth : List.of(0, 4, 8, 12)) {
      var p = surface.above(-depth);
      for (var direction : SkyMineTerrain.DIRECTIONS) {
        if (geology.mouth(p, direction))
          return Optional.of(new Mouth(p, SkyMineTerrain.at(p, direction, 12, 0)));
      }
    }
    return Optional.empty();
  }

  private static final class Working {
    private final SkyCell cell;
    private final SkyMineTerrain geology;
    private final Mouth mouth;
    private final Map<SkyPosition, SkyRoute.Segment> parents = new LinkedHashMap<>();
    private final Map<SkyPosition, Integer> distances = new LinkedHashMap<>();

    Working(SkyCell cell, SkyMineTerrain geology, Mouth mouth) {
      this.cell = cell;
      this.geology = geology;
      this.mouth = mouth;
      distances.put(mouth.inside(), 0);
    }

    private void explore(SkyPosition root) {
      var queue = new ArrayDeque<SkyPosition>();
      queue.add(root);
      while (!queue.isEmpty() && distances.size() < 1500) {
        var a = queue.remove();
        if (distance(a) >= 144) continue;
        for (var direction : SkyMineTerrain.DIRECTIONS) {
          var b = SkyMineTerrain.at(a, direction, 4, 0);
          if (eligible(b) && geology.tube(a, b)) {
            parents.put(b, new SkyRoute.Segment(a, b, SkyRoute.Kind.WALK));
            distances.put(b, distance(a) + 4);
            queue.add(b);
          }
        }
      }
    }

    private boolean eligible(SkyPosition p) {
      return !distances.containsKey(p)
          && Math.abs(p.x() - mouth.inside().x()) <= 80
          && Math.abs(p.z() - mouth.inside().z()) <= 80;
    }

    private Optional<SkyRoute.Segment> bridge() {
      var crossings = new ArrayList<SkyRoute.Segment>();
      for (var a : List.copyOf(distances.keySet())) {
        if (distance(a) > 96) continue;
        for (var direction : SkyMineTerrain.DIRECTIONS) {
          if (distances.containsKey(SkyMineTerrain.at(a, direction, 4, 0))) continue;
          geology
              .crossing(a, direction)
              .filter(this::eligible)
              .ifPresent(b -> crossings.add(new SkyRoute.Segment(a, b, SkyRoute.Kind.BRIDGE)));
        }
      }
      return crossings.stream()
          .max(
              Comparator.comparingDouble(
                  e -> e.from().distance(e.to()) - distance(e.from()) * .25));
    }

    SkyPlan finish() {
      explore(mouth.inside());
      var crossing = bridge();
      var targets = new ArrayList<SkyPosition>();
      if (crossing.isPresent()) {
        var edge = crossing.orElseThrow();
        parents.put(edge.to(), edge);
        distances.put(edge.to(), distance(edge.from()) + (int) edge.from().distance(edge.to()));
        explore(edge.to());
        targets.add(edge.to());
      }
      selectTargets(targets);
      var edges = paths(targets);
      var length = edges.stream().mapToDouble(e -> e.from().distance(e.to())).sum();
      if (length < 120) return SkyPlan.empty(cell, SkyCell.Kind.MINE);
      return new SkyMineGeometry(cell).build(edges, mouth);
    }

    private void selectTargets(List<SkyPosition> targets) {
      for (var i = 0; i < 3; i++) {
        var next =
            distances.keySet().stream()
                .filter(p -> targets.stream().allMatch(t -> p.distanceSquared(t) >= 400))
                .max(Comparator.comparingDouble(p -> separation(p, targets)));
        next.ifPresent(targets::add);
      }
    }

    private double separation(SkyPosition p, List<SkyPosition> targets) {
      var nearest = p.distance(mouth.inside());
      for (var target : targets) nearest = Math.min(nearest, p.distance(target));
      return nearest + .12 * distance(p);
    }

    private int distance(SkyPosition p) {
      return java.util.Objects.requireNonNull(distances.get(p), "Unvisited mine node");
    }

    private List<SkyRoute.Segment> paths(List<SkyPosition> targets) {
      var edges = new LinkedHashSet<SkyRoute.Segment>();
      edges.add(new SkyRoute.Segment(mouth.outside(), mouth.inside(), SkyRoute.Kind.WALK));
      for (var target : targets) {
        var p = target;
        while (parents.containsKey(p)) {
          var edge = parents.get(p);
          edges.add(edge);
          p = edge.from();
        }
      }
      return List.copyOf(edges);
    }
  }
}
