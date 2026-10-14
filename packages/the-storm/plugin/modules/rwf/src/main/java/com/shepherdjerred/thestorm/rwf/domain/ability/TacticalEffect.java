package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;

/** Tactical fields are visual and audible only; they never obstruct physical projectiles. */
public sealed interface TacticalEffect extends AbilityEffect.Extra {
  record ListeningPost(CombatantId owner, Vec3 at) implements TacticalEffect {}

  record Smoke(CombatantId owner, Vec3 at) implements TacticalEffect {}

  record RallySignal(CombatantId owner, Stage stage) implements TacticalEffect {}

  enum Stage {
    WINDUP,
    CANCELLED,
    COMPLETE
  }
}
