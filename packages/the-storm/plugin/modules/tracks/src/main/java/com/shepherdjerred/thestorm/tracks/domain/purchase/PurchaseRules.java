package com.shepherdjerred.thestorm.tracks.domain.purchase;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.app.Quote;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.domain.Pricing;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import com.shepherdjerred.thestorm.tracks.domain.purchase.rules.AffordableRule;
import com.shepherdjerred.thestorm.tracks.domain.purchase.rules.CooldownRule;
import com.shepherdjerred.thestorm.tracks.domain.purchase.rules.NextLevelOnlyRule;
import com.shepherdjerred.thestorm.tracks.domain.purchase.rules.NotMaxedRule;
import com.shepherdjerred.thestorm.tracks.domain.purchase.rules.WithinPrimaryRule;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

/**
 * Decides whether a player may buy a track level and what it costs. Every rule runs and every
 * problem is collected, so {@code /perks} can say everything standing in the way at once; they are
 * listed in rule order, most basic first.
 */
public final class PurchaseRules {

  private final Pricing pricing;
  private final List<PurchaseRule> rules;

  public PurchaseRules(Pricing pricing, List<PurchaseRule> rules) {
    this.pricing = pricing;
    this.rules = List.copyOf(rules);
  }

  /** The tracks rules: not maxed, next level only, within the primary, cooled down, affordable. */
  public static PurchaseRules standard(Pricing pricing, Duration cooldown) {
    return new PurchaseRules(
        pricing,
        List.of(
            new NotMaxedRule(),
            new NextLevelOnlyRule(),
            new WithinPrimaryRule(),
            new CooldownRule(cooldown),
            new AffordableRule(pricing)));
  }

  /** Every rule {@code attempt} breaks, in rule order. */
  public List<PurchaseProblem> problems(PurchaseAttempt attempt) {
    return rules.stream().flatMap(rule -> rule.check(attempt).stream()).toList();
  }

  /** The quote for {@code attempt} if it breaks no rule, else every problem. */
  public Result<Quote, List<PurchaseProblem>> validate(PurchaseAttempt attempt) {
    var problems = problems(attempt);
    if (!problems.isEmpty()) {
      return Result.err(problems);
    }
    return Result.ok(price(attempt.progress(), attempt.track(), attempt.level()));
  }

  /** The next level of {@code track} and its price, or empty when the track is maxed. */
  public Optional<Quote> nextLevel(TrackProgress progress, Track track) {
    var level = progress.level(track) + 1;
    return level > Track.MAX_LEVEL ? Optional.empty() : Optional.of(price(progress, track, level));
  }

  /** Every track, in {@link Track} order, with its level, next price and what blocks buying it. */
  public List<TrackStanding> overview(TrackProgress progress, Instant now, long balance) {
    return Arrays.stream(Track.values())
        .map(
            track ->
                new TrackStanding(
                    track,
                    progress.level(track),
                    progress.isPrimary(track),
                    nextLevel(progress, track),
                    problems(PurchaseAttempt.next(progress, track, now, balance))))
        .toList();
  }

  private Quote price(TrackProgress progress, Track track, int level) {
    return new Quote(track, level, pricing.cost(level, progress.position(track)));
  }
}
