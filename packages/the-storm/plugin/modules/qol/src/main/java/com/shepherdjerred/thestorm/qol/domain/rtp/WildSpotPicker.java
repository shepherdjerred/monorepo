package com.shepherdjerred.thestorm.qol.domain.rtp;

import java.util.List;
import java.util.Optional;
import java.util.random.RandomGenerator;

/**
 * Two batches in the ring. Each batch keeps the safe, unclaimed, right-biome samples and prefers
 * the ones farthest from claims and recent landings.
 */
public final class WildSpotPicker {

  private final AnnulusSampler sampler;
  private final CandidateFilter filter;
  private final SpotRanker ranker;

  public WildSpotPicker(int batchSize, int nearBestHundredths) {
    this.sampler = new AnnulusSampler(batchSize);
    this.filter = new CandidateFilter();
    this.ranker = new SpotRanker(nearBestHundredths);
  }

  /** One batch of offsets from the origin. */
  public List<BlockPoint> batch(SearchRing ring, RandomGenerator random) {
    return sampler.sample(ring, random);
  }

  /** The best of {@code samples} after {@code reject}, or empty. */
  public Optional<BlockPoint> rank(
      List<BlockPoint> samples,
      CandidateFilter.Reject reject,
      List<BlockPoint> repel,
      RandomGenerator random) {
    return ranker.choose(filter.keep(samples, reject), repel, random);
  }

  /** An offset from spawn, or empty when both batches fail. */
  public Optional<BlockPoint> pick(
      SearchRing ring,
      CandidateFilter.Reject reject,
      List<BlockPoint> repel,
      RandomGenerator random) {
    var first = once(ring, reject, repel, random);
    if (first.isPresent()) {
      return first;
    }
    return once(ring, reject, repel, random);
  }

  private Optional<BlockPoint> once(
      SearchRing ring,
      CandidateFilter.Reject reject,
      List<BlockPoint> repel,
      RandomGenerator random) {
    return ranker.choose(filter.keep(sampler.sample(ring, random), reject), repel, random);
  }
}
