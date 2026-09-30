package com.shepherdjerred.thestorm.qol.domain.rtp;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Random;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Ring, claim rejection, biome rejection and two landings that do not stack. */
final class WildSpotPickerTest {

  @Test
  void emptyClaimsStartPastTheGap() {
    var ring = SearchRing.around(0, 512, 1500, 30_000_000).orElseThrow();
    var samples = new AnnulusSampler(40).sample(ring, new Random(1));
    assertThat(samples).isNotEmpty();
    for (var sample : samples) {
      var distance = sample.distanceTo(new BlockPoint(0, 0));
      assertThat(distance).isBetween(ring.inner(), ring.outer());
    }
  }

  @Test
  void aTownAtSpawnPushesTheRingOut() {
    var spawn = new BlockPoint(0, 0);
    var farthest = SearchRing.farthest(spawn, List.of(new BlockPoint(80, 0)));
    var ring = SearchRing.around(farthest, 512, 1500, 30_000_000).orElseThrow();
    assertThat(ring.inner()).isEqualTo(592);
  }

  @Test
  void aClaimInsideTheRingIsDropped() {
    var claimed = new BlockPoint(1000, 0);
    var open = new BlockPoint(2000, 0);
    var picker = new WildSpotPicker(8, 90);
    var chosen =
        picker.rank(
            List.of(claimed, open),
            reject(Set.of(key(claimed)), Set.of(), Set.of()),
            List.of(new BlockPoint(0, 0)),
            new Random(1));
    assertThat(chosen).contains(open);
  }

  @Test
  void theWrongBiomeIsDropped() {
    var plains = new BlockPoint(1000, 0);
    var desert = new BlockPoint(1100, 0);
    var picker = new WildSpotPicker(8, 90);
    var chosen =
        picker.rank(
            List.of(plains, desert),
            reject(Set.of(), Set.of(), Set.of(key(plains))),
            List.of(new BlockPoint(0, 0)),
            new Random(1));
    assertThat(chosen).contains(desert);
  }

  @Test
  void theSecondLandingAvoidsTheFirst() {
    var first = new BlockPoint(2000, 0);
    var nearFirst = new BlockPoint(2050, 0);
    var opposite = new BlockPoint(-2000, 0);
    var ranker = new SpotRanker(90);
    var chosen = ranker.choose(List.of(nearFirst, opposite), List.of(first), new Random(1));
    assertThat(chosen).contains(opposite);
  }

  @Test
  void bothBatchesFailingReturnsEmpty() {
    var picker = new WildSpotPicker(4, 90);
    var ring = new SearchRing(10, 20);
    var chosen =
        picker.pick(
            ring,
            new CandidateFilter.Reject() {
              @Override
              public boolean claimed(BlockPoint point) {
                return true;
              }

              @Override
              public boolean unsafe(BlockPoint point) {
                return false;
              }

              @Override
              public boolean wrongBiome(BlockPoint point) {
                return false;
              }
            },
            List.of(),
            new Random(1));
    assertThat(chosen).isEmpty();
  }

  private static CandidateFilter.Reject reject(
      Set<Long> claimed, Set<Long> unsafe, Set<Long> wrongBiome) {
    return new CandidateFilter.Reject() {
      @Override
      public boolean claimed(BlockPoint point) {
        return claimed.contains(key(point));
      }

      @Override
      public boolean unsafe(BlockPoint point) {
        return unsafe.contains(key(point));
      }

      @Override
      public boolean wrongBiome(BlockPoint point) {
        return wrongBiome.contains(key(point));
      }
    };
  }

  private static long key(BlockPoint point) {
    return ((long) point.x() << 32) | (point.z() & 0xFFFF_FFFFL);
  }
}
