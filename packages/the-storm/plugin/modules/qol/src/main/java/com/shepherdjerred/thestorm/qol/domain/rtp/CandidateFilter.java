package com.shepherdjerred.thestorm.qol.domain.rtp;

import java.util.ArrayList;
import java.util.List;

/** Drops samples that are claimed, unsafe, or the wrong biome. */
public final class CandidateFilter {

  /** Why a sample cannot be a landing. */
  public interface Reject {

    boolean claimed(BlockPoint point);

    boolean unsafe(BlockPoint point);

    boolean wrongBiome(BlockPoint point);
  }

  /** The samples {@code reject} allows. */
  public List<BlockPoint> keep(List<BlockPoint> samples, Reject reject) {
    var kept = new ArrayList<BlockPoint>();
    for (var sample : samples) {
      if (allowed(sample, reject)) {
        kept.add(sample);
      }
    }
    return List.copyOf(kept);
  }

  private static boolean allowed(BlockPoint sample, Reject reject) {
    return !reject.claimed(sample) && !reject.unsafe(sample) && !reject.wrongBiome(sample);
  }
}
