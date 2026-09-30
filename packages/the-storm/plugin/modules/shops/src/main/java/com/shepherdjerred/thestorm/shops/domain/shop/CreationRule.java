package com.shepherdjerred.thestorm.shops.domain.shop;

import java.util.Optional;

/** One rule for making a shop sign. */
@FunctionalInterface
public interface CreationRule {

  Optional<CreationProblem> check(CreationAttempt attempt);
}
