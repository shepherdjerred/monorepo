package com.shepherdjerred.thestorm.tracks.domain.purchase.rules;

import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.domain.Pricing;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseAttempt;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseRule;
import java.util.Optional;

/**
 * The player must hold the level's price. The economy re-checks this when it charges; this rule
 * lets {@code /perks} say why a level is out of reach before anyone tries. A level that does not
 * exist has no price and is left to the level rules.
 */
public final class AffordableRule implements PurchaseRule {

  private final Pricing pricing;

  public AffordableRule(Pricing pricing) {
    this.pricing = pricing;
  }

  @Override
  public Optional<PurchaseProblem> check(PurchaseAttempt attempt) {
    if (!attempt.levelExists()) {
      return Optional.empty();
    }
    var cost = pricing.cost(attempt.level(), attempt.progress().position(attempt.track()));
    return attempt.balance() < cost
        ? Optional.of(new PurchaseProblem.CannotAfford(cost, attempt.balance()))
        : Optional.empty();
  }
}
