package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.HexFormat;

/**
 * Turns a block classification into a {@link NavArtifact}. Pure: the same blocks and sites always
 * bake the same artifact. Unknown shapes cannot occur because {@link BlockShape} is closed; a
 * classification that lies about its bounds is an error.
 */
public final class MapBaker {

  /** Bump when the analysis changes so stale artifacts are rebaked. */
  public static final int GENERATOR_VERSION = 1;

  private MapBaker() {}

  /** Bakes {@code mapId}. */
  public static NavArtifact bake(String mapId, BlockClassification blocks, NavSites sites) {
    var grid = VoxelGrid.from(blocks);
    var graph = NavGraphBuilder.build(blocks);
    var regions = Regions.build(graph, grid);
    var cover = CoverPoints.build(graph, grid);
    var routes = ApproachRoutes.build(graph, sites);
    var chokepoints = Chokepoints.build(graph, grid, routes);
    var fields = new HashMap<String, DistanceField>();
    for (var site : sites.spawns()) {
      graph
          .nearestNode(site.cell().feet())
          .ifPresent(node -> fields.put(site.name(), FlowField.toward(graph, node).distance()));
    }
    for (var site : sites.bombs()) {
      graph
          .nearestNode(site.cell().feet())
          .ifPresent(node -> fields.put(site.name(), FlowField.toward(graph, node).distance()));
    }
    return new NavArtifact(
        NavCodec.FORMAT_VERSION,
        GENERATOR_VERSION,
        mapId,
        sha256(blocks),
        sites,
        grid,
        graph,
        regions,
        cover,
        chokepoints,
        routes,
        fields);
  }

  /** The SHA-256 of the bounds, every cell's shape and whether it blocks sight, as hex. */
  public static String sha256(BlockClassification blocks) {
    MessageDigest digest;
    try {
      digest = MessageDigest.getInstance("SHA-256");
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 is mandatory in every JDK", e);
    }
    var bounds = blocks.bounds();
    digest.update(bounds.toString().getBytes(UTF_8));
    var origin = bounds.origin();
    var row = new byte[bounds.sizeX()];
    for (var y = 0; y < bounds.sizeY(); y++) {
      for (var z = 0; z < bounds.sizeZ(); z++) {
        for (var x = 0; x < bounds.sizeX(); x++) {
          var wx = origin.x() + x;
          var wy = origin.y() + y;
          var wz = origin.z() + z;
          var shape = blocks.shape(wx, wy, wz).code();
          row[x] = (byte) (shape << 1 | (blocks.blocksSight(wx, wy, wz) ? 1 : 0));
        }
        digest.update(row);
      }
    }
    return HexFormat.of().formatHex(digest.digest());
  }
}
