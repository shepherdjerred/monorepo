package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;
import java.util.TreeMap;

/**
 * Everything baked from one map, stored once and loaded per match.
 *
 * @param formatVersion the codec format this was written with
 * @param generatorVersion the baker version that produced the analysis
 * @param mapId which map
 * @param blocksSha256 the digest of the block classification the artifact was baked from
 * @param sites the spawns and bombs
 * @param grid the voxel layers
 * @param graph the nav graph
 * @param regions the region clustering and visibility table
 * @param cover the cover points
 * @param chokepoints the narrow passages
 * @param routes the approach routes
 * @param distanceFields path cost to each site, by site name
 */
public record NavArtifact(
    int formatVersion,
    int generatorVersion,
    String mapId,
    String blocksSha256,
    NavSites sites,
    VoxelGrid grid,
    NavGraph graph,
    Regions regions,
    CoverPoints cover,
    Chokepoints chokepoints,
    ApproachRoutes routes,
    Map<String, DistanceField> distanceFields) {

  public NavArtifact {
    if (formatVersion < 1 || generatorVersion < 1) {
      throw new IllegalArgumentException("versions start at 1");
    }
    if (mapId.isBlank() || blocksSha256.length() != 64) {
      throw new IllegalArgumentException("map id must be set and the digest 64 hex characters");
    }
    if (regions.nodeCount() != graph.nodeCount()) {
      throw new IllegalArgumentException("regions and graph disagree on node count");
    }
    // Keep the sorted view: Map.copyOf salts its iteration order per JVM, which
    // would make NavCodec write the DISTANCE section in a different order on
    // every run and break byte-for-byte artifact verification.
    distanceFields = Collections.unmodifiableMap(new TreeMap<>(distanceFields));
    for (var field : distanceFields.values()) {
      if (field.size() != graph.nodeCount()) {
        throw new IllegalArgumentException("distance field and graph disagree on node count");
      }
    }
  }

  /** Replaces observed door occlusion while retaining the validated terrain and graph identity. */
  public NavArtifact withGrid(VoxelGrid next) {
    if (!grid.bounds().equals(next.bounds()))
      throw new IllegalArgumentException("grid bounds changed");
    return new NavArtifact(
        formatVersion,
        generatorVersion,
        mapId,
        blocksSha256,
        sites,
        next,
        graph,
        regions,
        cover,
        chokepoints,
        routes,
        distanceFields);
  }

  /** The nav node a player uses to stand at or next to {@code site}. */
  public OptionalInt approachNode(NavSites.Site site) {
    if (sites.bombs().contains(site)) {
      var field = distanceFields.get(site.name());
      return field == null ? OptionalInt.empty() : ApproachNodes.baked(graph, site.cell(), field);
    }
    return graph.nearestNode(site.cell().feet());
  }

  /** The validated interaction position for the bomb at {@code cell}. */
  public OptionalInt bombApproach(BlockPos cell) {
    return sites.bombs().stream()
        .filter(site -> site.cell().equals(cell))
        .map(this::approachNode)
        .findFirst()
        .orElseGet(OptionalInt::empty);
  }

  /** The distance field towards {@code siteName}, which must exist. */
  public DistanceField distanceTo(String siteName) {
    var field = distanceFields.get(siteName);
    if (field == null) {
      throw new IllegalArgumentException("no distance field for site " + siteName);
    }
    return field;
  }

  /**
   * Everything that makes this artifact unplayable: no spawns or bombs, a spawn with no node to
   * stand on, a bomb nobody can stand next to, a bomb some spawn cannot reach, or a site without
   * its distance field. Empty means playable.
   */
  public List<NavProblem> validate() {
    var problems = new ArrayList<NavProblem>();
    if (sites.spawns().isEmpty()) {
      problems.add(new NavProblem(NavProblem.Kind.NO_SPAWNS, "the map has no spawns"));
    }
    if (sites.bombs().isEmpty()) {
      problems.add(new NavProblem(NavProblem.Kind.NO_BOMBS, "the map has no bombs"));
    }
    for (var spawn : sites.spawns()) {
      if (graph.nodeAt(spawn.cell()).isEmpty()) {
        problems.add(
            new NavProblem(
                NavProblem.Kind.SPAWN_NOT_WALKABLE, spawn.name() + " at " + spawn.cell()));
      }
    }
    for (var bomb : sites.bombs()) {
      var approach = approachNode(bomb);
      if (approach.isEmpty()) {
        problems.add(
            new NavProblem(
                NavProblem.Kind.BOMB_NOT_APPROACHABLE, bomb.name() + " at " + bomb.cell()));
        continue;
      }
      reachability(bomb, approach.getAsInt(), problems);
    }
    for (var site : sites.spawns()) {
      if (!distanceFields.containsKey(site.name())) {
        problems.add(new NavProblem(NavProblem.Kind.DISTANCE_FIELD_MISSING, site.name()));
      }
    }
    for (var site : sites.bombs()) {
      if (!distanceFields.containsKey(site.name())) {
        problems.add(new NavProblem(NavProblem.Kind.DISTANCE_FIELD_MISSING, site.name()));
      }
    }
    return problems;
  }

  private void reachability(NavSites.Site bomb, int approach, List<NavProblem> problems) {
    for (var spawn : sites.spawns()) {
      var from = graph.nodeAt(spawn.cell());
      if (from.isPresent() && graph.path(from.getAsInt(), approach).isEmpty()) {
        problems.add(
            new NavProblem(
                NavProblem.Kind.BOMB_UNREACHABLE, bomb.name() + " from " + spawn.name()));
      }
    }
  }
}
