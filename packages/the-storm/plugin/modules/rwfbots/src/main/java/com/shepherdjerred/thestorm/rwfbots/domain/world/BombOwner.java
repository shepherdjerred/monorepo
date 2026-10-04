package com.shepherdjerred.thestorm.rwfbots.domain.world;

import java.util.Optional;

/** Whose bomb it is: a team's, whose members die when it explodes, or an unowned nuke. */
public sealed interface BombOwner {

  /** A team's bomb. */
  record Team(TeamId team) implements BombOwner {}

  /** A nuke nobody owns; arming it hurts everyone else. */
  record Nuke() implements BombOwner {}

  default Optional<TeamId> owningTeam() {
    return this instanceof Team(var team) ? Optional.of(team) : Optional.empty();
  }

  default boolean isTeam(TeamId candidate) {
    return this instanceof Team(var team) && team.equals(candidate);
  }
}
