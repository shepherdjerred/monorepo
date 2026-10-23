package com.shepherdjerred.thestorm.rwfbots.domain.learning;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ActiveJump;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.CombatFootwork;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class CombatControlsTest {
  private static final UUID MATCH = new UUID(1, 2);
  private static final UUID BODY = new UUID(3, 4);
  private static final NavArtifact NAV = SyntheticMap.bake();

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
            context(authored, input), ticket(new CombatAction(7, true, false, true, true)));
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
    assertThat(CombatCommands.replace(context(authored, input(2, false)), ticket))
        .isEqualTo(authored);
    assertThat(CombatCommands.replace(context(authored, input(1, true)), ticket))
        .isEqualTo(authored);
    assertThat(CombatCommands.replace(context(authored, input(1, false)), ticket))
        .isEqualTo(authored);
  }

  @Test
  void visibleTargetsCannotOverwritePreparedOrCommittedFlightAfterAPlannerChange() {
    var jump =
        java.util.stream.IntStream.range(0, NAV.graph().edgeCount())
            .filter(edge -> NAV.graph().edgeHop(edge) == Hop.LEAP)
            .mapToObj(NAV.graph()::waypoint)
            .findFirst()
            .orElseThrow();
    var input = input(1, false);
    var authored =
        List.<BodyCommand>of(
            new BodyCommand.Look(90, 5),
            new BodyCommand.MoveToward(jump.pos(), true),
            new BodyCommand.Sneak(false),
            new BodyCommand.Jump());
    for (var stage :
        List.of(ActiveJump.Stage.BACKUP, ActiveJump.Stage.RUN_UP, ActiveJump.Stage.AIRBORNE)) {
      var state =
          ReflexState.initial(input.self().facing())
              .withActiveJump(
                  Optional.of(
                      new ActiveJump(
                          jump, new ActiveJump.Intent(Option.ENGAGE, jump.pos()), stage, 90, 95)));
      var context = new CombatCommands.Context(new Reflex.Step(state, authored), input, NAV);
      assertThat(CombatCommands.eligible(context)).as("committed %s", stage).isFalse();
      assertThat(
              CombatCommands.replace(
                  context, ticket(new CombatAction(0, false, true, false, true))))
          .isSameAs(context.authored().commands());
    }
  }

  @Test
  void waterClimbingAndPlannedDropsKeepAuthoredCommandsDespiteSwordContact() {
    var source = input(1, false);
    var authored =
        List.<BodyCommand>of(
            new BodyCommand.Look(90, 5), new BodyCommand.MoveToward(new Vec3(8, 1, 5), true));
    for (var hop : List.of(Hop.SWIM, Hop.CLIMB, Hop.DROP, Hop.JUMP)) {
      var decision =
          new Decision(
              source.self().id(),
              Option.ENGAGE,
              source.decision().target(),
              List.of(new Waypoint(new Vec3(8, 1, 5), hop)),
              Stance.AGGRESSIVE,
              Optional.empty(),
              Optional.empty(),
              Optional.empty(),
              "traversal",
              100,
              1,
              Optional.empty());
      var input =
          new ReflexInput(
              source.self(), source.snapshot(), decision, source.target(), 3, Optional.empty());
      var context = context(authored, input);
      assertThat(CombatCommands.eligible(context)).as("planned %s", hop).isFalse();
      assertThat(
              CombatCommands.replace(context, ticket(new CombatAction(0, true, true, true, true))))
          .isSameAs(context.authored().commands());
    }
  }

  @Test
  void actualUnpaidFallKeepsAuthoredLandingEvenWhenTheVisibleCombatDecisionStillSaysWalk() {
    var body = combatant(1, RED, new Vec3(5, 1, 5)).withHands(1, false);
    var source = input(body);
    var decision =
        new Decision(
            body.id(),
            Option.ENGAGE,
            source.decision().target(),
            List.of(new Waypoint(body.pos().plus(0, 0, 1), Hop.WALK)),
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "combat-walk",
            100,
            1,
            Optional.empty());
    var authored =
        List.<BodyCommand>of(
            new BodyCommand.Look(90, 5), new BodyCommand.MoveToward(new Vec3(5.5, 1, 5.5), false));
    var flat =
        new ReflexInput(body, source.snapshot(), decision, source.target(), 3, Optional.empty());
    var ticket = ticket(new CombatAction(7, false, false, true, true));
    assertThat(CombatCommands.eligible(context(authored, flat), ticket)).isTrue();
    var falling = body.withTraversal(body.traversal().withFallDistance(8));
    var fallSource = input(falling);
    var input =
        new ReflexInput(
            falling, fallSource.snapshot(), decision, fallSource.target(), 3, Optional.empty());
    var context = context(authored, input);
    assertThat(CombatCommands.eligible(context)).isFalse();
    assertThat(CombatCommands.eligible(context, ticket)).isFalse();
    assertThat(CombatCommands.replace(context, ticket)).isSameAs(context.authored().commands());
  }

  @Test
  void actualMidDepthWaterKeepsAuthoredControlWithoutAWaypoint() {
    var nav = MapBaker.bake("water", new Water(), new NavSites(List.of(), List.of()));
    var input = input(combatant(1, RED, new Vec3(1.5, 2, 1.5)).withHands(1, false));
    assertThat(nav.graph().water().contains(BlockPos.of(input.self().pos()))).isTrue();
    var authored =
        new Reflex.Step(
            ReflexState.initial(input.self().facing()),
            List.of(new BodyCommand.MoveToward(new Vec3(1.5, 4, 1.5), false)));
    var context = new CombatCommands.Context(authored, input, nav);
    assertThat(
            CombatCommands.replace(context, ticket(new CombatAction(4, false, false, false, true))))
        .isSameAs(authored.commands());
  }

  @Test
  void actorCannotReenableSprintWhenTheActualBodyCannotSprint() {
    var capability = new TraversalState(false, 3, 1, 0, -1, -1, -1, -1, 0, -1, -1, -1, -1, 20, 0);
    var input =
        input(combatant(1, RED, new Vec3(5, 1, 5)).withHands(1, false).withTraversal(capability));
    var context = context(List.of(new BodyCommand.Stop()), input);
    assertThat(CombatCommands.eligible(context)).isTrue();
    var action = ticket(new CombatAction(7, false, false, true, false));
    assertThat(CombatCommands.eligible(context, action)).isFalse();
    assertThat(CombatCommands.replace(context, action)).isSameAs(context.authored().commands());
  }

  @Test
  void unsafeActorDodgesKeepAuthoredFootworkAtLedgesAndHeadHeightWalls() {
    var body = combatant(1, RED, new Vec3(5.5, 1, 5.5)).withHands(1, false);
    var input = input(body, body.pos().plus(0, 0, 2));
    var actor = ticket(new CombatAction(7, false, false, true, true));
    var authored =
        new Reflex.Step(ReflexState.initial(body.facing()), List.of(new BodyCommand.Stop()));
    var ledge =
        MapBaker.bake(
            "ledge",
            new Arena(Optional.of(new BlockPos(6, 0, 5)), Optional.empty()),
            new NavSites(List.of(), List.of()));
    var wall =
        MapBaker.bake(
            "wall",
            new Arena(Optional.empty(), Optional.of(new BlockPos(6, 2, 5))),
            new NavSites(List.of(), List.of()));
    for (var nav : List.of(ledge, wall)) {
      assertThat(nav.grid().canSee(body.eye(), input.target().orElseThrow().eye())).isTrue();
      var context = new CombatCommands.Context(authored, input, nav);
      assertThat(CombatCommands.eligible(context)).isTrue();
      assertThat(CombatCommands.eligible(context, actor)).isFalse();
      assertThat(CombatCommands.replace(context, actor)).isSameAs(authored.commands());
    }
  }

  @Test
  void optionalJumpsRejectSideGapsReachableByFutureTurnsEvenWhenInitialHeadingIsSafe() {
    var nav =
        MapBaker.bake(
            "side-gap",
            new Arena(Optional.of(new BlockPos(6, 0, 4)), Optional.empty()),
            new NavSites(List.of(), List.of()));
    var body = combatant(1, RED, new Vec3(5.5, 1, 5.5)).withHands(1, false);
    var context =
        new CombatCommands.Context(
            new Reflex.Step(ReflexState.initial(body.facing()), List.of(new BodyCommand.Stop())),
            input(body),
            nav);
    assertThat(CombatFootwork.safe(nav.grid(), body, new Vec3(1, 0, 0))).isTrue();
    assertThat(
            CombatCommands.eligible(context, ticket(new CombatAction(7, false, false, true, true))))
        .isTrue();
    var jump = ticket(new CombatAction(7, true, false, true, true));
    assertThat(CombatCommands.eligible(context, jump)).isFalse();
    assertThat(CombatCommands.replace(context, jump)).isSameAs(context.authored().commands());
  }

  private record Arena(Optional<BlockPos> gap, Optional<BlockPos> obstacle)
      implements BlockClassification {
    @Override
    public GridBounds bounds() {
      return new GridBounds(new BlockPos(0, 0, 0), 12, 8, 12);
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      var cell = new BlockPos(x, y, z);
      if (gap.filter(cell::equals).isPresent()) return BlockShape.PASSABLE;
      return y == 0 || obstacle.filter(cell::equals).isPresent()
          ? BlockShape.FULL
          : BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return shape(x, y, z).blocksMovement();
    }
  }

  private static final class Water implements BlockClassification {
    @Override
    public GridBounds bounds() {
      return new GridBounds(new BlockPos(0, 0, 0), 4, 6, 4);
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      return y == 0 ? BlockShape.FULL : BlockShape.LIQUID;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return y == 0;
    }
  }

  private static CombatCommands.Context context(List<BodyCommand> authored, ReflexInput input) {
    return new CombatCommands.Context(
        new Reflex.Step(ReflexState.initial(input.self().facing()), authored), input, NAV);
  }

  private static ActionTicket ticket(CombatAction action) {
    return new ActionTicket(MATCH, BODY, 1, 100, -90, action);
  }

  private static ReflexInput input(int slot, boolean using) {
    return input(combatant(1, RED, new Vec3(5, 1, 5)).withHands(slot, using));
  }

  private static ReflexInput input(CombatantView self) {
    return input(self, self.pos().plus(2, 0, 0));
  }

  private static ReflexInput input(CombatantView self, Vec3 targetPosition) {
    var target = combatant(2, BLUE, targetPosition);
    var snapshot =
        new WorldSnapshot(
            100,
            MatchPhase.LIVE,
            List.of(self, target),
            List.of(),
            PoisonView.NONE,
            "test",
            List.of(),
            List.of());
    return new ReflexInput(
        self, snapshot, Decision.idle(self.id(), 100, 1), Optional.of(target), 3, Optional.empty());
  }
}
