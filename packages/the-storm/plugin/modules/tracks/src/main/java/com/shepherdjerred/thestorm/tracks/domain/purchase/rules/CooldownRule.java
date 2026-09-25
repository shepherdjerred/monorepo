package com.shepherdjerred.thestorm.tracks.domain.purchase.rules;

import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseAttempt;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseRule;
import java.time.Duration;
import java.util.Optional;

/**
 * After buying a level a player waits {@code cooldown} before buying another, in any track. The
 * wait ends exactly at {@code lastPurchase + cooldown}. A zero cooldown disables the rule.
 */
public final class CooldownRule implements PurchaseRule {

  private final Duration cooldown;

  public CooldownRule(Duration cooldown) {
    if (cooldown.isNegative()) {
      throw new IllegalArgumentException("cooldown must not be negative: " + cooldown);
    }
    this.cooldown = cooldown;
  }

  @Override
  public Optional<PurchaseProblem> check(PurchaseAttempt attempt) {
    if (cooldown.isZero()) {
      return Optional.empty();
    }
    return attempt
        .progress()
        .lastPurchase()
        .map(last -> last.plus(cooldown))
        .filter(availableAt -> attempt.now().isBefore(availableAt))
        .map(PurchaseProblem.CoolingDown::new);
  }
}
