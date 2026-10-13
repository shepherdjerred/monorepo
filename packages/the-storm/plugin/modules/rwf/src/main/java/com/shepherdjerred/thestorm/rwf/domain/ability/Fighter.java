package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;

/**
 * A combatant as abilities see them.
 *
 * @param id who
 * @param name their name, for messages
 * @param team their team
 * @param kit their kit id
 * @param alive whether they are still fighting
 */
public record Fighter(CombatantId id, String name, TeamColor team, String kit, boolean alive) {

  public boolean allyOf(Fighter other) {
    return team == other.team;
  }
}
