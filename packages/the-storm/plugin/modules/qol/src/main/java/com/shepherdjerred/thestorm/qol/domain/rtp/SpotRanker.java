package com.shepherdjerred.thestorm.qol.domain.rtp;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.random.RandomGenerator;

/**
 * Picks a landing far from settled points. Among spots close to the best distance, the choice is
 * random, so two players do not share one cell.
 */
public final class SpotRanker {

  private final int nearBestHundredths;

  public SpotRanker(int nearBestHundredths) {
    if (nearBestHundredths < 1 || nearBestHundredths > 100) {
      throw new IllegalArgumentException("nearBestHundredths must be 1-100: " + nearBestHundredths);
    }
    this.nearBestHundredths = nearBestHundredths;
  }

  /** A spot from {@code candidates}, or empty when none remain. */
  public Optional<BlockPoint> choose(
      List<BlockPoint> candidates, List<BlockPoint> repel, RandomGenerator random) {
    if (candidates.isEmpty()) {
      return Optional.empty();
    }
    if (repel.isEmpty()) {
      return Optional.of(candidates.get(random.nextInt(candidates.size())));
    }
    return Optional.of(amongBest(candidates, repel, random));
  }

  private BlockPoint amongBest(
      List<BlockPoint> candidates, List<BlockPoint> repel, RandomGenerator random) {
    var scores = scores(candidates, repel);
    var best = 0;
    for (var score : scores) {
      best = Math.max(best, score);
    }
    var cutoff = (int) ((long) best * nearBestHundredths / 100);
    var kept = new ArrayList<BlockPoint>();
    for (var i = 0; i < candidates.size(); i++) {
      if (scores[i] >= cutoff) {
        kept.add(candidates.get(i));
      }
    }
    return kept.get(random.nextInt(kept.size()));
  }

  private static int[] scores(List<BlockPoint> candidates, List<BlockPoint> repel) {
    var scores = new int[candidates.size()];
    for (var i = 0; i < candidates.size(); i++) {
      scores[i] = nearest(candidates.get(i), repel);
    }
    return scores;
  }

  private static int nearest(BlockPoint point, List<BlockPoint> repel) {
    var best = Integer.MAX_VALUE;
    for (var other : repel) {
      best = Math.min(best, point.distanceTo(other));
    }
    return best;
  }
}
