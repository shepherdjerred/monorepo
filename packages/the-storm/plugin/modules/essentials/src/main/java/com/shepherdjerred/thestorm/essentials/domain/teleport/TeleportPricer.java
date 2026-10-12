package com.shepherdjerred.thestorm.essentials.domain.teleport;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Optional;

/** Pure pricing: a shared rolling allowance, exponential escalation and one cooldown. */
public final class TeleportPricer {
  private final TeleportPricing pricing;

  public TeleportPricer(TeleportPricing pricing) {
    this.pricing = pricing;
  }

  public TeleportPricing pricing() {
    return pricing;
  }

  public Result<Quote, OnCooldown> quote(
      TeleportKind kind, Optional<TeleportUsage> usage, Exemptions exemptions, Instant now) {
    var history = usage.orElse(TeleportUsage.EMPTY);
    if (!exemptions.ignoresCooldown() && now.isBefore(history.cooldownUntil())) {
      return Result.err(new OnCooldown(kind, Duration.between(now, history.cooldownUntil())));
    }
    return Result.ok(preview(kind, history, exemptions, now));
  }

  /** Read-only preview even during a cooldown; no use is recorded until arrival. */
  public Quote preview(
      TeleportKind kind, TeleportUsage history, Exemptions exemptions, Instant now) {
    var base = pricing.prices().of(kind);
    var active = new ArrayList<>(history.active(pricing.window(), now));
    var used = active.stream().mapToLong(TeleportUse::halfPoints).sum();
    var excess = Math.max(0, used + base.halfPoints() - pricing.allowanceHalfPoints());
    var steps = Math.ceilDiv(excess, 2);
    // Clamp before exponentiation, including when a staff member bypasses cooldowns.
    var multiplier =
        Multiplier.of(
            Math.min(pricing.maxMultiplier(), Math.scalb(1.0, (int) Math.min(steps, 63))));
    var cost = exemptions.free() ? 0 : multiplier.applyTo(base.cost());
    var cooldown =
        exemptions.ignoresCooldown() ? Duration.ZERO : multiplier.applyTo(base.cooldown());
    active.add(new TeleportUse(now, base.halfPoints()));
    return new Quote(kind, cost, multiplier, new TeleportUsage(active, now.plus(cooldown)));
  }
}
