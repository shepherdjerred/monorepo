package com.shepherdjerred.thestorm.tracks.domain.purchase;

import static com.shepherdjerred.thestorm.tracks.app.Track.ENGINEER;
import static com.shepherdjerred.thestorm.tracks.app.Track.GOVERNOR;
import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.app.Track.SHOPKEEPER;
import static com.shepherdjerred.thestorm.tracks.app.Track.SPELLCASTER;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.DEFAULT_PRICING;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.NOW;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.boughtAt;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.owning;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.app.Quote;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

final class PurchaseRulesTest {

  private static final long RICH = 1_000_000;
  private static final Duration DAY = Duration.ofHours(24);

  private final PurchaseRules rules = PurchaseRules.standard(DEFAULT_PRICING, DAY);
  private final PurchaseRules noCooldown = PurchaseRules.standard(DEFAULT_PRICING, Duration.ZERO);

  /** Buys the next level of {@code track}, failing the test if refused. */
  private static TrackProgress buy(
      PurchaseRules rules, TrackProgress progress, Track track, Instant at) {
    var result = rules.validate(PurchaseAttempt.next(progress, track, at, RICH));
    assertThat(result.isOk()).as("buying %s from %s: %s", track, progress, result).isTrue();
    return progress.purchased(track, progress.level(track) + 1, at);
  }

  @Test
  void aNewPlayerMayStartAnyTrackAndItBecomesPrimary() {
    for (var track : Track.values()) {
      var result =
          noCooldown.validate(PurchaseAttempt.next(TrackProgress.empty(), track, NOW, RICH));

      assertThat(result).isEqualTo(Result.ok(new Quote(track, 1, 1_000)));
      var after = TrackProgress.empty().purchased(track, 1, NOW);
      assertThat(after.isPrimary(track)).isTrue();
    }
  }

  @Test
  void eachNewTrackCostsMoreInTheOrderItWasStarted() {
    var progress = TrackProgress.empty();
    var prices = new java.util.ArrayList<Long>();
    for (var track : List.of(GOVERNOR, SPELLCASTER, MECHANIC, SHOPKEEPER, ENGINEER)) {
      prices.add(noCooldown.nextLevel(progress, track).orElseThrow().cost());
      progress = buy(noCooldown, progress, track, NOW);
    }

    assertThat(prices).containsExactly(1_000L, 1_500L, 2_000L, 3_000L, 4_000L);
    assertThat(progress.primary().orElseThrow().track()).isEqualTo(GOVERNOR);
  }

  @Test
  void aTracksMultiplierStaysWithItAtEveryLevel() {
    var progress = owning(MECHANIC, 3, ENGINEER, 2);

    assertThat(noCooldown.nextLevel(progress, MECHANIC)).contains(new Quote(MECHANIC, 4, 10_000));
    assertThat(noCooldown.nextLevel(progress, ENGINEER)).contains(new Quote(ENGINEER, 3, 7_500));
    assertThat(noCooldown.nextLevel(progress, GOVERNOR)).contains(new Quote(GOVERNOR, 1, 2_000));
  }

  @Test
  void aMaxedTrackHasNoNextLevel() {
    assertThat(noCooldown.nextLevel(owning(MECHANIC, 5), MECHANIC)).isEmpty();
  }

  @Test
  void aPlayerCanClimbEveryTrackToFiveOneLevelAtATime() {
    var progress = TrackProgress.empty();
    for (var level = 1; level <= Track.MAX_LEVEL; level++) {
      for (var track : Track.values()) {
        progress = buy(noCooldown, progress, track, NOW);
      }
    }

    for (var track : Track.values()) {
      assertThat(progress.level(track)).isEqualTo(Track.MAX_LEVEL);
    }
  }

  @Test
  void aSecondaryWaitsForThePrimary() {
    var progress = buy(noCooldown, TrackProgress.empty(), MECHANIC, NOW);
    progress = buy(noCooldown, progress, ENGINEER, NOW);

    var refused = noCooldown.validate(PurchaseAttempt.next(progress, ENGINEER, NOW, RICH));

    assertThat(refused)
        .isEqualTo(Result.err(List.of(new PurchaseProblem.AbovePrimary(ENGINEER, 2, MECHANIC, 1))));
    progress = buy(noCooldown, progress, MECHANIC, NOW);
    buy(noCooldown, progress, ENGINEER, NOW);
  }

  @Test
  void skippingALevelIsRefused() {
    var result =
        noCooldown.validate(new PurchaseAttempt(owning(MECHANIC, 1), MECHANIC, 3, NOW, RICH));

    assertThat(result)
        .isEqualTo(Result.err(List.of(new PurchaseProblem.NotNextLevel(MECHANIC, 1, 3))));
  }

  @Test
  void theCooldownSpacesPurchases() {
    var progress = buy(rules, TrackProgress.empty(), MECHANIC, NOW);

    var tooSoon =
        rules.validate(PurchaseAttempt.next(progress, MECHANIC, NOW.plusSeconds(1), RICH));
    assertThat(tooSoon)
        .isEqualTo(Result.err(List.of(new PurchaseProblem.CoolingDown(NOW.plus(DAY)))));

    buy(rules, progress, MECHANIC, NOW.plus(DAY));
  }

  @Test
  void everyProblemIsReportedInRuleOrder() {
    var progress = boughtAt(owning(MECHANIC, 1, ENGINEER, 1), NOW);

    var result = rules.validate(PurchaseAttempt.next(progress, ENGINEER, NOW, 10));

    assertThat(result)
        .isEqualTo(
            Result.err(
                List.of(
                    new PurchaseProblem.AbovePrimary(ENGINEER, 2, MECHANIC, 1),
                    new PurchaseProblem.CoolingDown(NOW.plus(DAY)),
                    new PurchaseProblem.CannotAfford(3_750, 10))));
  }

  @Test
  void aMaxedTrackReportsOnlyThatItIsMaxed() {
    var result = rules.validate(PurchaseAttempt.next(owning(MECHANIC, 5), MECHANIC, NOW, RICH));

    assertThat(result).isEqualTo(Result.err(List.of(new PurchaseProblem.AlreadyMaxed(MECHANIC))));
  }

  @Test
  void theOverviewListsEveryTrackWithWhatBlocksIt() {
    var progress = owning(MECHANIC, 2, ENGINEER, 2, GOVERNOR, 2);

    var overview = noCooldown.overview(progress, NOW, 3_000);

    assertThat(overview)
        .containsExactly(
            new TrackStanding(
                SHOPKEEPER,
                0,
                false,
                java.util.Optional.of(new Quote(SHOPKEEPER, 1, 3_000)),
                List.of()),
            new TrackStanding(
                MECHANIC,
                2,
                true,
                java.util.Optional.of(new Quote(MECHANIC, 3, 5_000)),
                List.of(new PurchaseProblem.CannotAfford(5_000, 3_000))),
            new TrackStanding(
                ENGINEER,
                2,
                false,
                java.util.Optional.of(new Quote(ENGINEER, 3, 7_500)),
                List.of(
                    new PurchaseProblem.AbovePrimary(ENGINEER, 3, MECHANIC, 2),
                    new PurchaseProblem.CannotAfford(7_500, 3_000))),
            new TrackStanding(
                SPELLCASTER,
                0,
                false,
                java.util.Optional.of(new Quote(SPELLCASTER, 1, 3_000)),
                List.of()),
            new TrackStanding(
                GOVERNOR,
                2,
                false,
                java.util.Optional.of(new Quote(GOVERNOR, 3, 10_000)),
                List.of(
                    new PurchaseProblem.AbovePrimary(GOVERNOR, 3, MECHANIC, 2),
                    new PurchaseProblem.CannotAfford(10_000, 3_000))));
    assertThat(overview.getFirst().buyable()).isTrue();
    assertThat(overview.get(1).buyable()).isFalse();
  }

  @Test
  void aMaxedTrackIsNotBuyable() {
    var standing = noCooldown.overview(owning(MECHANIC, 5), NOW, RICH).get(1);

    assertThat(standing.next()).isEmpty();
    assertThat(standing.buyable()).isFalse();
  }
}
