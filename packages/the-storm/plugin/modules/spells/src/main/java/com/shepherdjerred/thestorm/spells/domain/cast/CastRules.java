package com.shepherdjerred.thestorm.spells.domain.cast;

import com.shepherdjerred.thestorm.spells.domain.Refusal;
import java.util.List;
import java.util.Optional;

/**
 * The gates in the order a player should hear about them: availability and access first, then
 * silences and cooldowns, then reagents. Every refusal is collected; callers show the first.
 */
public final class CastRules {

  private final List<CastRule> rules;

  private CastRules(List<CastRule> rules) {
    this.rules = List.copyOf(rules);
  }

  /** The gates for casting. */
  public static CastRules casting() {
    return new CastRules(
        List.of(
            new EnabledRule(),
            new TierRule(),
            new LearnedRule(),
            new SilenceRule(),
            new CooldownRule(),
            new ReagentRule()));
  }

  /** The gates for binding a focus: the spell must be available and known. */
  public static CastRules binding() {
    return new CastRules(List.of(new EnabledRule(), new TierRule(), new LearnedRule()));
  }

  /** Every refusal, in gate order; empty when the attempt may go ahead. */
  public List<Refusal> check(CastAttempt attempt) {
    return rules.stream().flatMap(rule -> rule.check(attempt).stream()).toList();
  }

  /** The first refusal, if any. */
  public Optional<Refusal> first(CastAttempt attempt) {
    return check(attempt).stream().findFirst();
  }
}
