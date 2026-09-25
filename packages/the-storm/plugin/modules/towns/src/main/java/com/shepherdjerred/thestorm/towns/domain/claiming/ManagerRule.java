package com.shepherdjerred.thestorm.towns.domain.claiming;

import java.util.Optional;

/** Only roles that manage claims may claim, unclaim or change flags. */
final class ManagerRule implements ClaimRule {

  @Override
  public Optional<ClaimProblem> check(ClaimAttempt attempt) {
    var role = attempt.role();
    return role.managesClaims()
        ? Optional.empty()
        : Optional.of(new ClaimProblem.CannotManageClaims(role));
  }
}
