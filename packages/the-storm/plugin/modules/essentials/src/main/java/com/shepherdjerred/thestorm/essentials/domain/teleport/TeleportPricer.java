package com.shepherdjerred.thestorm.essentials.domain.teleport;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.Instant;

/** Flat price and per-command cooldown. A failed or cancelled trip records nothing. */
public final class TeleportPricer {
  private final TeleportPricing pricing;

  public TeleportPricer(TeleportPricing pricing) {
    this.pricing = pricing;
  }

  public TeleportPricing pricing() {
    return pricing;
  }

  public Result<Quote, OnCooldown> quote(
      TeleportKind kind, TeleportUsage usage, Exemptions exemptions, Instant now) {
    var until = usage.until(kind);
    if (!exemptions.ignoresCooldown() && now.isBefore(until)) {
      return Result.err(new OnCooldown(kind, Duration.between(now, until)));
    }
    return Result.ok(preview(kind, exemptions));
  }

  /** The price with no cooldown check and no recorded use. */
  public Quote preview(TeleportKind kind, Exemptions exemptions) {
    var base = pricing.prices().of(kind);
    var cost = exemptions.free() ? 0 : base.cost();
    var cooldown = exemptions.ignoresCooldown() ? Duration.ZERO : base.cooldown();
    return new Quote(kind, cost, cooldown);
  }
}
