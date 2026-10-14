package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;

/** Native operations and owner-visible salvage belonging to expansion abilities. */
public sealed interface ExpansionEffect extends AbilityEffect.Extra {
  record DisableShield(CombatantId victim, int ticks) implements ExpansionEffect {}

  record Flask(CombatantId owner) implements ExpansionEffect {}

  record Salvage(CombatantId owner, CombatantId victim, Vec3 at) implements ExpansionEffect {}

  record ClearSalvage(CombatantId owner, CombatantId victim) implements ExpansionEffect {}
}
