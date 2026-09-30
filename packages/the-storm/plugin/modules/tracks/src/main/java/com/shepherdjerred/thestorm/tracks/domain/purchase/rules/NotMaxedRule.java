package com.shepherdjerred.thestorm.tracks.domain.purchase.rules;

import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseAttempt;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseRule;
import java.util.Optional;

/** A track at {@link Track#MAX_LEVEL} has nothing left to buy. */
public final class NotMaxedRule implements PurchaseRule {

  @Override
  public Optional<PurchaseProblem> check(PurchaseAttempt attempt) {
    return attempt.progress().level(attempt.track()) >= Track.MAX_LEVEL
        ? Optional.of(new PurchaseProblem.AlreadyMaxed(attempt.track()))
        : Optional.empty();
  }
}
