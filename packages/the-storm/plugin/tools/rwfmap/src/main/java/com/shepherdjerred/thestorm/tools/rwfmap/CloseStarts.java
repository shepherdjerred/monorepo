package com.shepherdjerred.thestorm.tools.rwfmap;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import java.util.ArrayList;
import java.util.BitSet;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/** Deterministic grounded starts on unchanged terrain, reachable from every original team. */
final class CloseStarts {
  record Pair(Vec3 first, Vec3 second) {}

  private record Offset(int x, int z) {
    double length() {
      return Math.hypot(x, z);
    }
  }

  private record Candidates(int reachable, BitSet flat) {}

  private final NavArtifact artifact;
  private final NavGraph graph;
  private final StartTerrain terrain;
  private final Candidates candidates;

  private CloseStarts(SchematicClassification blocks, NavArtifact artifact) {
    this.artifact = artifact;
    graph = artifact.graph();
    terrain = new StartTerrain(blocks);
    candidates = reachableCandidates();
  }

  static Pair select(MapFolder map, Baker.Baked baked) {
    if (!baked.playable())
      throw new IllegalArgumentException("Close starts require a playable original map");
    var selector = new CloseStarts(map.classify(), baked.artifact());
    var sites = baked.artifact().sites().spawns();
    var center = Vec3.ZERO;
    for (var site : sites) center = center.plus(site.cell().feet());
    return selector.select(center.scale(1.0 / sites.size()));
  }

  private Candidates reachableCandidates() {
    var found = new BitSet(graph.nodeCount());
    found.set(0, graph.nodeCount());
    for (var spawn : artifact.sites().spawns()) {
      var source = graph.nearestNode(spawn.cell().feet()).orElseThrow();
      var costs = graph.costsFrom(source);
      for (var node = found.nextSetBit(0); node >= 0; node = found.nextSetBit(node + 1)) {
        if (!Float.isFinite(costs[node])) found.clear(node);
      }
    }
    var reachable = found.cardinality();
    for (var node = found.nextSetBit(0); node >= 0; node = found.nextSetBit(node + 1)) {
      if (!terrain.patch(graph.cell(node), CloseStartReport.CONTRACT.clearanceRadius()))
        found.clear(node);
    }
    return new Candidates(reachable, found);
  }

  private Pair select(Vec3 center) {
    var order =
        candidates.flat().stream()
            .boxed()
            .sorted(
                Comparator.comparingDouble(
                        (Integer node) -> graph.feet(node).horizontalDistance(center))
                    .thenComparingInt(Integer::intValue))
            .toList();
    var offsets = offsets();
    for (var node : order) {
      var from = graph.cell(node);
      for (var offset : offsets) {
        var other = graph.nodeAt(from.offset(offset.x(), 0, offset.z()));
        if (other.isPresent() && candidates.flat().get(other.getAsInt())) {
          var pair = pair(node, other.getAsInt());
          if (pair.isPresent()) return pair.orElseThrow();
        }
      }
    }
    throw new IllegalArgumentException(
        "No reachable grounded close-combat starts on unchanged terrain: "
            + candidates.reachable()
            + " cells reachable from every original spawn, "
            + candidates.flat().cardinality()
            + " flat patches");
  }

  private Optional<Pair> pair(int first, int second) {
    var from = graph.feet(first);
    var to = graph.feet(second);
    if (!terrain.corridor(from, to)
        || !artifact.grid().canSee(from.plus(0, 1.62, 0), to.plus(0, 1.62, 0)))
      return Optional.empty();
    var limit = from.horizontalDistance(to) * 1.5;
    if (graph.path(first, second).filter(path -> path.cost() <= limit).isEmpty()
        || graph.path(second, first).filter(path -> path.cost() <= limit).isEmpty())
      return Optional.empty();
    return Optional.of(new Pair(from, to));
  }

  private static List<Offset> offsets() {
    var contract = CloseStartReport.CONTRACT;
    var bound = (int) Math.floor(contract.maxSeparation());
    var offsets = new ArrayList<Offset>();
    for (var x = -bound; x <= bound; x++) {
      for (var z = -bound; z <= bound; z++) {
        var offset = new Offset(x, z);
        if (offset.length() >= contract.minSeparation()
            && offset.length() <= contract.maxSeparation()) offsets.add(offset);
      }
    }
    offsets.sort(
        Comparator.comparingDouble(
                (Offset offset) -> Math.abs(offset.length() - contract.targetSeparation()))
            .thenComparingInt(Offset::x)
            .thenComparingInt(Offset::z));
    return List.copyOf(offsets);
  }
}
