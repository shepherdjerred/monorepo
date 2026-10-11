package com.shepherdjerred.thestorm.rwfbots.domain.learning;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class CombatControlsTest {
  private static final UUID MATCH = new UUID(1, 2);
  private static final UUID BODY = new UUID(3, 4);

  @Test
  void actionsExpireAndCannotCrossMatchBodyOrLife() {
    var ticket = ticket(new CombatAction(4, false, false, false, false));
    assertThat(ticket.applies(MATCH, BODY, 1, 99)).isFalse();
    assertThat(ticket.applies(MATCH, BODY, 1, 100)).isTrue();
    assertThat(ticket.applies(MATCH, BODY, 1, 102)).isTrue();
    assertThat(ticket.applies(MATCH, BODY, 1, 103)).isFalse();
    assertThat(ticket.applies(new UUID(5, 6), BODY, 1, 100)).isFalse();
    assertThat(ticket.applies(MATCH, new UUID(5, 6), 1, 100)).isFalse();
    assertThat(ticket.applies(MATCH, BODY, 2, 100)).isFalse();
    assertThatIllegalArgumentException()
        .isThrownBy(() -> new CombatAction(9, false, false, false, false));
  }

  @Test
  void movementUsesAcknowledgedYawWhileAuthoredAimAndAttackTargetStayIntact() {
    var input = input(1, false);
    var look = new BodyCommand.Look(90, 5);
    var authored =
        List.<BodyCommand>of(look, new BodyCommand.Stop(), new BodyCommand.SelectSlot(1));
    var commands =
        CombatCommands.replace(
            authored, input, ticket(new CombatAction(7, true, false, true, true)));
    assertThat(commands)
        .contains(
            look,
            new BodyCommand.SelectSlot(1),
            new BodyCommand.Jump(),
            new BodyCommand.Attack(input.target().orElseThrow().id()));
    assertThat(commands).doesNotContain(new BodyCommand.Stop());
    var move =
        commands.stream()
            .filter(BodyCommand.MoveToward.class::isInstance)
            .map(BodyCommand.MoveToward.class::cast)
            .findFirst()
            .orElseThrow();
    assertThat(move.waypoint().minus(input.self().pos()).x())
        .isCloseTo(1, org.assertj.core.data.Offset.offset(1e-9));
    assertThat(move.waypoint().minus(input.self().pos()).z())
        .isCloseTo(0, org.assertj.core.data.Offset.offset(1e-9));
  }

  @Test
  void externalControlCannotInterruptHealingOrControlOtherSlots() {
    var authored = List.<BodyCommand>of(new BodyCommand.StartUse(), new BodyCommand.Stop());
    var ticket = ticket(new CombatAction(7, true, true, true, true));
    assertThat(CombatCommands.replace(authored, input(2, false), ticket)).isEqualTo(authored);
    assertThat(CombatCommands.replace(authored, input(1, true), ticket)).isEqualTo(authored);
    assertThat(CombatCommands.replace(authored, input(1, false), ticket)).isEqualTo(authored);
  }

  private static ActionTicket ticket(CombatAction action) {
    return new ActionTicket(MATCH, BODY, 1, 100, -90, action);
  }

  private static ReflexInput input(int slot, boolean using) {
    var self = combatant(1, RED, new Vec3(5, 1, 5)).withHands(slot, using);
    var target = combatant(2, BLUE, new Vec3(7, 1, 5));
    var snapshot =
        new WorldSnapshot(
            100,
            MatchPhase.LIVE,
            List.of(self, target),
            List.of(),
            PoisonView.NONE,
            "test",
            List.of());
    return new ReflexInput(
        self, snapshot, Decision.idle(self.id(), 100, 1), Optional.of(target), 3);
  }
}
