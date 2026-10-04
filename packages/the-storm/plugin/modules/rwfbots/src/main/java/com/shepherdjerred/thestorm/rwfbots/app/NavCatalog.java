package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

/**
 * The decoded nav artifacts, released for play one map at a time. An artifact is decoded and
 * validated at enable, but it is only usable once the match has chosen its map and the map's block
 * hash has been seen to equal the hash the artifact was baked from; a stale or missing artifact
 * leaves the map humans-only and says why. Main thread only.
 */
public final class NavCatalog implements NavArtifacts {

  private final Map<String, NavArtifact> decoded = new TreeMap<>();
  private final Map<String, String> problems = new TreeMap<>();
  private final Map<String, NavArtifact> confirmed = new HashMap<>();

  /** Registers a decoded, validated artifact for {@code mapId}. */
  public void add(NavArtifact artifact) {
    decoded.put(artifact.mapId(), artifact);
    problems.remove(artifact.mapId());
  }

  /** Records that {@code mapId} has no usable artifact and why. */
  public void reject(String mapId, String problem) {
    decoded.remove(mapId);
    confirmed.remove(mapId);
    problems.put(mapId, problem);
  }

  /**
   * The match chose {@code mapId} whose terrain hashes to {@code blocksSha256}: releases its
   * artifact if it was baked from that terrain. Returns the problem when it was not.
   */
  public Optional<String> confirm(String mapId, String blocksSha256) {
    var artifact = decoded.get(mapId);
    if (artifact == null) {
      var reason = problems.getOrDefault(mapId, "no nav artifact was loaded for this map");
      problems.put(mapId, reason);
      return Optional.of(reason);
    }
    if (!artifact.blocksSha256().equals(blocksSha256)) {
      var reason =
          "nav artifact was baked from blocks "
              + artifact.blocksSha256()
              + " but the map's blocks hash to "
              + blocksSha256
              + "; rebake it";
      confirmed.remove(mapId);
      problems.put(mapId, reason);
      return Optional.of(reason);
    }
    confirmed.put(mapId, artifact);
    problems.remove(mapId);
    return Optional.empty();
  }

  @Override
  public Optional<NavArtifact> forMap(String mapId) {
    return Optional.ofNullable(confirmed.get(mapId));
  }

  /** Every map that was decoded, whether or not confirmed yet. */
  public Map<String, NavArtifact> decoded() {
    return Map.copyOf(decoded);
  }

  /** Why each map without a usable artifact has none. */
  public Map<String, String> problems() {
    return Map.copyOf(problems);
  }
}
