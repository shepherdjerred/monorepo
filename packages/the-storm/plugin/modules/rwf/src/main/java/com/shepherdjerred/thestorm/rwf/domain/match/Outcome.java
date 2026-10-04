package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.util.Optional;

/** How a match ended. */
public sealed interface Outcome {

  default Optional<TeamColor> winner() {
    return this instanceof Winner(var team) ? Optional.of(team) : Optional.empty();
  }

  /**
   * One team outlived the rest.
   *
   * @param team the winners
   */
  record Winner(TeamColor team) implements Outcome {}

  /** The last teams fell together. */
  record Draw() implements Outcome {}

  /** An admin or the plugin stopped the match. */
  record Stopped() implements Outcome {}
}
