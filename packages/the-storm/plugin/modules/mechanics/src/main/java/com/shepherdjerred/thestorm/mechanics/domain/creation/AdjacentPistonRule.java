package com.shepherdjerred.thestorm.mechanics.domain.creation;

import com.shepherdjerred.thestorm.mechanics.domain.piston.PistonRules;
import java.util.Optional;

/**
 * A piston sign touches a piston, or a sticky piston for {@code [SuperSticky]}.
 *
 * @param stickyOnly whether only a sticky piston will do
 */
public record AdjacentPistonRule(boolean stickyOnly) implements CreationRule {

  @Override
  public Optional<Refusal> check(CreationRequest request) {
    var found =
        request.sign().neighbors().stream()
            .map(pos -> request.grid().cellAt(pos).material())
            .anyMatch(stickyOnly ? PistonRules::isSticky : PistonRules::isPiston);
    if (found) {
      return Optional.empty();
    }
    return Optional.of(
        new Refusal(
            stickyOnly
                ? "Put this sign against a sticky piston."
                : "Put this sign against a piston."));
  }
}
