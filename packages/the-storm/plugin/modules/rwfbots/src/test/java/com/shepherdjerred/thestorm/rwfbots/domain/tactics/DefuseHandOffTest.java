package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Slot;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamNote;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamPlan;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Who works a lit own fuse: a responder stuck in a fight passes it on, a second responder starts
 * from the real deadline, idle screens beside a fuse help click, and a fuse worker with time in
 * hand waits for its retake team instead of walking in alone.
 */
final class DefuseHandOffTest {
  private static final NavArtifact NAV = SyntheticMap.bake();
  private static final Vec3 BOMB = SyntheticMap.RED_BOMB.center();
  private static final long NOW = 200;
  private static final TacticsContext CONTEXT =
      new TacticsContext(
          NAV,
          Fixtures.levers(0.5),
          new Style(0.5, 0.5, 0.5, 0.5),
          Kit.TROOPER,
          Archetype.TACTICIAN,
          Set.of(),
          1,
          null);

  private static Vec3 at(double dx, double dz) {
    return new Vec3(BOMB.x() + dx, 1, BOMB.z() + dz);
  }

  private static BombView own(com.shepherdjerred.thestorm.rwfbots.domain.world.BombState state) {
    return new BombView(new BombId(0), new BombOwner.Team(RED), BOMB, state);
  }

  /** {@code bodies.getFirst()}'s situation; it sees every enemy among {@code bodies}. */
  private static Situation situation(
      List<CombatantView> bodies, BombView bomb, Blackboard board, Role role) {
    var snapshot =
        new WorldSnapshot(
            NOW,
            MatchPhase.LIVE,
            bodies,
            List.of(bomb),
            PoisonView.NONE,
            NAV.mapId(),
            List.of(),
            List.of(),
            List.of());
    var visible = bodies.stream().filter(body -> !body.team().equals(RED)).toList();
    return new Situation(
        bodies.getFirst(), snapshot, new Percept(PerceptionState.EMPTY, visible, NOW), board, role);
  }

  private static List<CombatantView> with(CombatantView self, List<CombatantView> others) {
    var out = new ArrayList<CombatantView>();
    out.add(self);
    out.addAll(others);
    return out;
  }

  /** A board whose defense formation gives each bot the role named for it. */
  private static Blackboard formation(BombView bomb, Map<CombatantView, Role> roles) {
    var slots = new ArrayList<Slot>();
    var assignment =
        new HashMap<com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId, String>();
    var index = 0;
    for (var entry : roles.entrySet()) {
      var key = "station-" + index++;
      slots.add(
          new Slot(
              key,
              SlotKind.ANCHOR,
              entry.getValue(),
              entry.getKey().pos(),
              bomb.pos(),
              -1,
              -1,
              Optional.empty(),
              0));
      assignment.put(entry.getKey().id(), key);
    }
    var plan =
        new TeamPlan(
            Optional.of(Strategy.RUSH),
            Optional.empty(),
            Optional.of(bomb.id()),
            List.of(),
            0,
            slots,
            assignment,
            0,
            Map.of(),
            -1);
    return Blackboard.open(RED, Strategy.RUSH).withPlan(plan, 0);
  }

  @Test
  void aResponderStuckInAFightPassesTheFuseToTheNextBot() {
    var near = combatant(1, RED, at(2, 0));
    var next = combatant(2, RED, at(9, 0));
    var bomb = own(new BombState.Armed(1000));
    var free = Blackboard.open(RED, Strategy.RUSH);
    assertThat(
            ObjectivePolicy.responds(
                situation(List.of(near, next), bomb, free, Role.ROTATE), CONTEXT))
        .isTrue();
    assertThat(
            ObjectivePolicy.responds(
                situation(List.of(next, near), bomb, free, Role.ROTATE), CONTEXT))
        .as("a second responder with time in hand stays put")
        .isFalse();

    var shortFight = free.note(near.id(), TeamNote.NONE.engaged(NOW - 20));
    assertThat(
            ObjectivePolicy.responds(
                situation(List.of(next, near), bomb, shortFight, Role.ROTATE), CONTEXT))
        .as("a moment's fight is no hand-off")
        .isFalse();

    var stuck = free.note(near.id(), TeamNote.NONE.engaged(NOW - Blackboard.PINNED_TICKS));
    assertThat(
            ObjectivePolicy.responds(
                situation(List.of(near, next), bomb, stuck, Role.ROTATE), CONTEXT))
        .isFalse();
    assertThat(
            ObjectivePolicy.responds(
                situation(List.of(next, near), bomb, stuck, Role.ROTATE), CONTEXT))
        .isTrue();
  }

  @Test
  void aSecondResponderStartsFromItsOwnDeadline() {
    var near = combatant(1, RED, at(2, 0));
    var far = combatant(2, RED, at(9, 0));
    var board = Blackboard.open(RED, Strategy.RUSH);
    // Nine blocks are about forty walking ticks: with the solo work, the safety margin and the
    // backup reserve the second responder must leave once about 520 ticks remain.
    assertThat(
            ObjectivePolicy.responds(
                situation(List.of(far, near), own(new BombState.Armed(700)), board, Role.ROTATE),
                CONTEXT))
        .isFalse();
    assertThat(
            ObjectivePolicy.responds(
                situation(List.of(far, near), own(new BombState.Armed(500)), board, Role.ROTATE),
                CONTEXT))
        .isTrue();
  }

  @Test
  void anIdleScreenBesideAShortHandedDefuseHelpsClick() {
    var worker = combatant(1, RED, at(1, 0));
    var screen = combatant(2, RED, at(5, 0));
    var roles = new java.util.LinkedHashMap<CombatantView, Role>();
    roles.put(worker, Role.RETAKE);
    roles.put(screen, Role.DEFEND);
    var started = own(new BombState.Defusing(0.2, 1, 900));
    var board = formation(started, roles);
    var helping = situation(List.of(screen, worker), started, board, Role.DEFEND);
    assertThat(ObjectivePolicy.responds(helping, CONTEXT)).isTrue();
    assertThat(Tactics.assignedDefuser(helping)).isTrue();
    assertThat(ObjectivePolicy.guards(helping, CONTEXT)).isFalse();

    var full = own(new BombState.Defusing(0.2, ObjectivePolicy.DEFUSE_STACK, 900));
    assertThat(
            ObjectivePolicy.responds(
                situation(List.of(screen, worker), full, board, Role.DEFEND), CONTEXT))
        .as("a full stack needs no more hands")
        .isFalse();
    var enemy = combatant(9, BLUE, at(12, 4));
    assertThat(
            ObjectivePolicy.responds(
                situation(List.of(screen, worker, enemy), started, board, Role.DEFEND), CONTEXT))
        .as("a screen with an enemy in sight keeps screening")
        .isFalse();
    var untouched = own(new BombState.Armed(900));
    assertThat(
            ObjectivePolicy.responds(
                situation(List.of(screen, worker), untouched, board, Role.DEFEND), CONTEXT))
        .as("nobody to help before the workers start")
        .isFalse();
  }

  @Test
  void aFuseWorkerWithTimeInHandWaitsForItsRetakeTeam() {
    var worker = combatant(1, RED, at(11, 0));
    var screenA = combatant(2, RED, new Vec3(28.5, 1, 28.5));
    var screenB = combatant(3, RED, new Vec3(27.5, 1, 26.5));
    var roles = new java.util.LinkedHashMap<CombatantView, Role>();
    roles.put(worker, Role.RETAKE);
    roles.put(screenA, Role.DEFEND);
    roles.put(screenB, Role.DEFEND);
    var early = own(new BombState.Armed(1100));
    var board = formation(early, roles);
    assertThat(
            ObjectivePolicy.direct(
                    TacticalMemory.EMPTY,
                    situation(List.of(worker, screenA, screenB), early, board, Role.RETAKE),
                    CONTEXT)
                .forced())
        .contains(Option.HOLD_ANGLE);

    var late = own(new BombState.Armed(400));
    assertThat(
            ObjectivePolicy.direct(
                    TacticalMemory.EMPTY,
                    situation(List.of(worker, screenA, screenB), late, board, Role.RETAKE),
                    CONTEXT)
                .forced())
        .as("without time to wait it goes alone")
        .contains(Option.DEFUSE);

    var arrived = List.of(screenA.withPos(at(6, 4)), screenB.withPos(at(6, -4)));
    assertThat(
            ObjectivePolicy.direct(
                    TacticalMemory.EMPTY,
                    situation(with(worker, arrived), early, board, Role.RETAKE),
                    CONTEXT)
                .forced())
        .as("with its team there it commits")
        .contains(Option.DEFUSE);
  }
}
