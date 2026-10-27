package com.shepherdjerred.thestorm.towns.domain.claiming;

import java.util.Optional;

/** Town owners and assistants may claim. On a camp, every member may claim a shared chunk. */
final class ClaimPermissionRule implements ClaimRule {

  @Override
  public Optional<ClaimProblem> check(ClaimAttempt attempt) {
    var role = attempt.role();
    if (role.managesClaims() || attempt.town().isCamp()) {
      return Optional.empty();
    }
    return Optional.of(new ClaimProblem.CannotManageClaims(role));
  }
}
