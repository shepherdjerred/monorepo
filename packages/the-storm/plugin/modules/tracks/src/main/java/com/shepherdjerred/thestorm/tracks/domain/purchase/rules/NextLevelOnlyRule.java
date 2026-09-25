package com.shepherdjerred.thestorm.tracks.domain.purchase.rules;

import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseAttempt;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseRule;
import java.util.Optional;

/**
 * Levels are bought one at a time, in order: only the level right after the current one. A maxed
 * track is left to {@link NotMaxedRule}.
 */
public final class NextLevelOnlyRule implements PurchaseRule {

  @Override
  public Optional<PurchaseProblem> check(PurchaseAttempt attempt) {
    var current = attempt.progress().level(attempt.track());
    if (current >= Track.MAX_LEVEL || attempt.level() == current + 1) {
      return Optional.empty();
    }
    return Optional.of(new PurchaseProblem.NotNextLevel(attempt.track(), current, attempt.level()));
  }
}
