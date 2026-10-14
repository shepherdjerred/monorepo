package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import java.util.List;

/** Facts and player actions used by the classic and ranged expansion kits. */
public sealed interface ExpansionInput extends AbilityInput.Extra {
  record StrikeFacts(AttackType type, boolean isolated, double distance, boolean fullyDrawn)
      implements ExpansionInput {}

  record ShieldBlock(int raisedTicks) implements ExpansionInput {}

  record ShieldContact(CombatantId victim) implements ExpansionInput {}

  record AirJump(boolean airborne, double verticalVelocity) implements ExpansionInput {}

  record ThrowFlask() implements ExpansionInput {}

  record FlaskSplash(List<CombatantId> targets) implements ExpansionInput {
    public FlaskSplash {
      targets = List.copyOf(targets);
    }
  }
}
