package com.shepherdjerred.thestorm.tools.rwfmap;

import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavProblem;
import java.util.List;

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
    private final List<NavProblem> problems;

    Baked(NavArtifact artifact, byte[] bytes, String summary, List<NavProblem> problems) {
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

    /** What {@link NavArtifact#validate()} found; empty for a playable map. */
    public List<NavProblem> problems() {
      return problems;
    }

    public boolean playable() {
      return problems.isEmpty();
    }
  }

  private Baker() {}

  /** Bakes {@code map}; the same folder always yields the same bytes. */
  public static Baked bake(MapFolder map) {
    var classification = map.classify();
    var sites = Sites.of(map.definition());
    var baked = MapBaker.bake(map.id(), classification, sites);
    var artifact =
        new NavArtifact(
            baked.formatVersion(),
            baked.generatorVersion(),
            baked.mapId(),
            map.schematic().sha256(),
            baked.sites(),
            baked.grid(),
            baked.graph(),
            baked.regions(),
            baked.cover(),
            baked.chokepoints(),
            baked.routes(),
            baked.distanceFields());
    var bytes = NavCodec.encode(artifact);
    var problems = artifact.validate();
    var summary = Summary.of(artifact, classification, problems, bytes);
    return new Baked(artifact, bytes, summary, problems);
  }
}
