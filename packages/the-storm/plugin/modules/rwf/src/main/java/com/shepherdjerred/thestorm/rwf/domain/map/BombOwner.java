// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/TeamBomb.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.map;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.util.Optional;

/**
 * Who a bomb site belongs to in the map data: a team's own bomb, or a nuke ({@code PLAYER Bombs} in
 * Red Warfare's config) that any team may arm.
 */
public sealed interface BombOwner {

  /** The owning team, if the bomb is a team bomb. */
  default Optional<TeamColor> team() {
    return switch (this) {
      case Team(var color) -> Optional.of(color);
      case Nuke _ -> Optional.empty();
    };
  }

  default boolean isNuke() {
    return this instanceof Nuke;
  }

  /**
   * A team bomb: exploding it kills the team's living members.
   *
   * @param color the team
   */
  record Team(TeamColor color) implements BombOwner {}

  /** A nuke: exploding it kills everyone not on the team that armed it. */
  record Nuke() implements BombOwner {}
}
