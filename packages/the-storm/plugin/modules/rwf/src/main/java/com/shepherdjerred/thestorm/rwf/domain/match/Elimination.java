package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.bomb.Bomb;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.util.List;

/** A surviving team must clear armed objectives that can still eliminate it. */
final class Elimination {
  private Elimination() {}

  static boolean threatened(TeamColor team, List<Bomb> bombs) {
    return bombs.stream()
        .filter(Bomb::armed)
        .anyMatch(
            bomb -> bomb.team().filter(owner -> (owner == team) != bomb.isNuke()).isPresent());
  }
}
