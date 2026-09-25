package com.shepherdjerred.thestorm.essentials.domain.teleport;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/** Quotes teleports under a {@link TeleportPricing}. Pure: the caller supplies the time. */
public final class TeleportPricer {

  private final TeleportPricing pricing;

  public TeleportPricer(TeleportPricing pricing) {
    this.pricing = pricing;
  }

  /**
   * The multiplier in force at {@code now}: the stored multiplier minus one decay step for every
   * whole {@code decayEvery} since the last use, never below ×1.
   */
  public Multiplier currentMultiplier(Optional<TeleportUsage> usage, Instant now) {
    if (usage.isEmpty()) {
      return Multiplier.ONE;
    }
    var used = usage.orElseThrow();
    var elapsed = Duration.between(used.lastUsed(), now);
    if (elapsed.isNegative()) {
      return used.multiplier();
    }
    var steps = elapsed.toMillis() / pricing.decayEvery().toMillis();
    var decay = steps > used.multiplier().hundredths() ? used.multiplier().hundredths() : steps;
    return used.multiplier().shrink(Math.multiplyExact(decay, pricing.decayStep()));
  }

  /**
   * Quotes a teleport of {@code kind} at {@code now}, or refuses it while the cooldown runs.
   *
   * <p>The cost and cooldown use the multiplier in force now; the quote's next usage carries the
   * multiplier raised by one growth step for the teleport after this one.
   */
  public Result<Quote, OnCooldown> quote(
      TeleportKind kind, Optional<TeleportUsage> usage, Exemptions exemptions, Instant now) {
    if (!exemptions.ignoresCooldown() && usage.isPresent()) {
      var until = usage.orElseThrow().cooldownUntil();
      if (now.isBefore(until)) {
        return Result.err(new OnCooldown(kind, Duration.between(now, until)));
      }
    }
    var base = pricing.prices().of(kind);
    var multiplier = currentMultiplier(usage, now);
    var cost = exemptions.free() ? 0 : multiplier.applyTo(base.cost());
    var cooldown =
        exemptions.ignoresCooldown() ? Duration.ZERO : multiplier.applyTo(base.cooldown());
    var next =
        new TeleportUsage(
            multiplier.grow(pricing.growthStep(), pricing.cap()), now, now.plus(cooldown));
    return Result.ok(new Quote(kind, cost, multiplier, next));
  }
}
