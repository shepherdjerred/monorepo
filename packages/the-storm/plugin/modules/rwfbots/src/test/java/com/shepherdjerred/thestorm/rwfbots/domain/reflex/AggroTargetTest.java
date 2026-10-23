package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Grudge;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Memory;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Suspicion;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** Of the enemies in reach, the reflex layer fights the one that just hurt the bot. */
final class AggroTargetTest {

  private static final CombatantView SELF = combatant(1, RED, new Vec3(5.5, 1, 5.5));
  private static final CombatantView BYSTANDER = combatant(2, BLUE, SELF.pos().plus(2, 0, 0));
  private static final CombatantView ATTACKER = combatant(3, BLUE, SELF.pos().plus(0, 0, 3.5));

  private static Percept percept(Optional<Grudge> grudge, CombatantView... visible) {
    return new Percept(
        new PerceptionState(Memory.EMPTY, Suspicion.NONE, -1, grudge), List.of(visible), 200);
  }

  private static Optional<CombatantView> target(Percept percept) {
    return ReflexInput.resolveTarget(SELF, Decision.idle(SELF.id(), 200, 0), percept);
  }

  @Test
  void theAttackerInReachIsFoughtBeforeANearerBystander() {
    var grudge = Optional.of(new Grudge(ATTACKER.id(), 190, SELF.pos()));
    assertThat(target(percept(Optional.empty(), BYSTANDER, ATTACKER))).contains(BYSTANDER);
    assertThat(target(percept(grudge, BYSTANDER, ATTACKER))).contains(ATTACKER);
  }

  @Test
  void anAttackerOutOfReachOrForgivenLeavesTheNearestEnemy() {
    var far = ATTACKER.withPos(SELF.pos().plus(0, 0, 9));
    var grudge = Optional.of(new Grudge(ATTACKER.id(), 190, SELF.pos()));
    assertThat(target(percept(grudge, BYSTANDER, far))).contains(BYSTANDER);
    var lapsed = Optional.of(new Grudge(ATTACKER.id(), 200 - Grudge.WINDOW_TICKS - 1, SELF.pos()));
    assertThat(target(percept(lapsed, BYSTANDER, ATTACKER))).contains(BYSTANDER);
  }
}
