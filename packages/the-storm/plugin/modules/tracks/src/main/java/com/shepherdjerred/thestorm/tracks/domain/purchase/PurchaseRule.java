package com.shepherdjerred.thestorm.tracks.domain.purchase;

import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import java.util.Optional;

/**
 * One condition a track purchase must meet. Rules are small and composed by {@link PurchaseRules}.
 */
@FunctionalInterface
public interface PurchaseRule {

  /** Why {@code attempt} breaks this rule, or empty when it meets it. */
  Optional<PurchaseProblem> check(PurchaseAttempt attempt);
}
