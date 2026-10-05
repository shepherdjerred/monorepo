package com.shepherdjerred.thestorm.tools.rwfmap;

import com.shepherdjerred.thestorm.rwfbots.domain.lobby.LobbyNav;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavProblem;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import java.util.List;
import java.util.function.Function;

/**
 * Bakes a map folder into the bytes rwfbots loads. The artifact's {@code blocksSha256} is the
 * schematic hash rwf verifies the world against ({@code map.yml}'s {@code blocksSha256}), so the
 * runtime can refuse an artifact baked from other terrain; the digest of the classification itself
 * is kept in the summary for review.
 */
public final class Baker {

  /** One bake: the artifact, its bytes, the review summary and what validation found. */
  public static final class Baked {

    private final NavArtifact artifact;
    private final byte[] bytes;
    private final String summary;
    private final List<String> problems;

    Baked(NavArtifact artifact, byte[] bytes, String summary, List<String> problems) {
      this.artifact = artifact;
      this.bytes = bytes.clone();
      this.summary = summary;
      this.problems = List.copyOf(problems);
    }

    /** The artifact as baked. */
    public NavArtifact artifact() {
      return artifact;
    }

    /** Its encoded form, what {@code nav.rwfnav} holds. */
    public byte[] bytes() {
      return bytes.clone();
    }

    /** The JSON review summary, what {@code nav.summary.json} holds. */
    public String summary() {
      return summary;
    }

    /** What validation found; empty for a playable map or a usable lobby. */
    public List<String> problems() {
      return problems;
    }

    public boolean playable() {
      return problems.isEmpty();
    }
  }

  private Baker() {}

  /** Bakes {@code map}; the same folder always yields the same bytes. */
  public static Baked bake(MapFolder map) {
    return bake(
        map.id(),
        map.classify(),
        Sites.of(map.definition()),
        artifact -> artifact.validate().stream().map(NavProblem::toString).toList());
  }

  /**
   * Bakes the lobby under {@link LobbyNav#ID}, its places as spawn sites and no bombs, judged by
   * {@link LobbyNav#problems}; the same folder always yields the same bytes.
   */
  public static Baked bake(LobbyFolder lobby) {
    return bake(LobbyNav.ID, lobby.classify(), lobby.sites(), LobbyNav::problems);
  }

  private static Baked bake(
      String id,
      SchematicClassification classification,
      NavSites sites,
      Function<NavArtifact, List<String>> validate) {
    var baked = MapBaker.bake(id, classification, sites);
    var artifact =
        new NavArtifact(
            baked.formatVersion(),
            baked.generatorVersion(),
            baked.mapId(),
            classification.schematic().sha256(),
            baked.sites(),
            baked.grid(),
            baked.graph(),
            baked.regions(),
            baked.cover(),
            baked.chokepoints(),
            baked.routes(),
            baked.distanceFields());
    var bytes = NavCodec.encode(artifact);
    var problems = validate.apply(artifact);
    var summary = Summary.of(artifact, classification, problems, bytes);
    return new Baked(artifact, bytes, summary, problems);
  }
}
