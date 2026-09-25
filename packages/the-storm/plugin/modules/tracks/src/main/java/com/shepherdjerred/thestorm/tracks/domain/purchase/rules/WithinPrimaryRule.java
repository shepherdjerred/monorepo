package com.shepherdjerred.thestorm.tracks.domain.purchase.rules;

import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseAttempt;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseRule;
import java.util.Optional;

/**
 * A secondary track can never be above the primary's level: buying secondary level N needs the
 * primary at N or higher. The first track a player buys becomes their primary, so it always passes.
 * A level that does not exist is left to the level rules.
 */
public final class WithinPrimaryRule implements PurchaseRule {

  @Override
  public Optional<PurchaseProblem> check(PurchaseAttempt attempt) {
    if (!attempt.levelExists()) {
      return Optional.empty();
    }
    return attempt
        .progress()
        .primary()
        .filter(primary -> primary.track() != attempt.track())
        .filter(primary -> attempt.level() > primary.level())
        .map(
            primary ->
                new PurchaseProblem.AbovePrimary(
                    attempt.track(), attempt.level(), primary.track(), primary.level()));
  }
}
