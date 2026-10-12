package com.shepherdjerred.thestorm.tools.rwfmap;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import java.util.ArrayList;
import java.util.BitSet;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/** Deterministic grounded duel starts on unchanged original terrain. */
final class CloseStarts {
  record Pair(Vec3 first, Vec3 second) {}

  private record Offset(int x, int z) {
    double length() {
      return Math.hypot(x, z);
    }
  }

  private record Candidates(int walkable, BitSet flat) {}

  private static final class SearchStats {
    int inRangePairs;
    int obstructedCorridors;
    int obstructedSightlines;
    int longPaths;
  }

  private final NavArtifact artifact;
  private final NavGraph graph;
  private final StartTerrain terrain;
  private final Candidates candidates;

  private CloseStarts(SchematicClassification blocks, NavArtifact artifact) {
    this.artifact = artifact;
    graph = artifact.graph();
    terrain = new StartTerrain(blocks);
    candidates = terrainCandidates();
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

  private Candidates terrainCandidates() {
    var found = new BitSet(graph.nodeCount());
    found.set(0, graph.nodeCount());
    var walkable = found.cardinality();
    for (var node = found.nextSetBit(0); node >= 0; node = found.nextSetBit(node + 1)) {
      if (!terrain.patch(graph.cell(node), CloseStartReport.CONTRACT.clearanceRadius()))
        found.clear(node);
    }
    return new Candidates(walkable, found);
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
    var stats = new SearchStats();
    for (var node : order) {
      for (var offset : offsets) {
        var pair = pair(node, offset, stats);
        if (pair.isPresent()) return pair.orElseThrow();
      }
    }
    throw new IllegalArgumentException(
        "No grounded close-combat starts on unchanged terrain: "
            + candidates.walkable()
            + " walkable cells, "
            + candidates.flat().cardinality()
            + " flat patches, "
            + stats.inRangePairs
            + " in-range pairs, "
            + stats.obstructedCorridors
            + " blocked corridors, "
            + stats.obstructedSightlines
            + " blocked sightlines, "
            + stats.longPaths
            + " overlong paths");
  }

  private Optional<Pair> pair(int node, Offset offset, SearchStats stats) {
    var other = graph.nodeAt(graph.cell(node).offset(offset.x(), 0, offset.z()));
    if (other.isEmpty() || !candidates.flat().get(other.getAsInt())) return Optional.empty();
    stats.inRangePairs++;
    var first = graph.feet(node);
    var second = graph.feet(other.getAsInt());
    var clearCorridor = terrain.corridor(first, second);
    var clearSightline = artifact.grid().canSee(first.plus(0, 1.62, 0), second.plus(0, 1.62, 0));
    var limit = first.horizontalDistance(second) * 1.5;
    var shortPaths =
        graph.path(node, other.getAsInt()).filter(path -> path.cost() <= limit).isPresent()
            && graph.path(other.getAsInt(), node).filter(path -> path.cost() <= limit).isPresent();
    if (!clearCorridor) stats.obstructedCorridors++;
    if (!clearSightline) stats.obstructedSightlines++;
    if (!shortPaths) stats.longPaths++;
    if (!clearCorridor || !clearSightline || !shortPaths) return Optional.empty();
    return Optional.of(new Pair(first, second));
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
