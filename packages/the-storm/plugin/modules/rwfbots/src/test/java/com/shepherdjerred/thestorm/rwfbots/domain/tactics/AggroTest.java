package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Grudge;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Memory;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Sighting;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Suspicion;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.record.DecisionTrace;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Slot;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamPlan;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/**
 * A bot that is hit answers its attacker, within reason: it watches it, fights it before a
 * bystander, closes on it inside its leash, and still runs when low and still defuses a lit fuse.
 */
final class AggroTest {
  private static final NavArtifact NAV = SyntheticMap.bake();
  private static final long NOW = 200;
  private static final long HIT = 180;
  private static final Vec3 HOME = new Vec3(2.5, 1, 2.5);
  private static final DecisionTrace.Feature AGGRO = new DecisionTrace.Feature("aggro", 1);

  /**
   * What one bot faces.
   *
   * @param self the bot
   * @param seen enemies in sight
   * @param remembered enemies placed in memory by their hit, out of sight
   * @param grudge who hit it
   * @param slot where it holds, if anywhere
   */
  private record Scene(
      CombatantView self,
      List<CombatantView> seen,
      List<CombatantView> remembered,
      Optional<Grudge> grudge,
      Optional<Slot> slot) {

    Scene(CombatantView self, Optional<Grudge> grudge) {
      this(self, List.of(), List.of(), grudge, Optional.of(holding(self.pos())));
    }

    Scene seeing(CombatantView... enemies) {
      return new Scene(self, List.of(enemies), remembered, grudge, slot);
    }

    Scene remembering(CombatantView... enemies) {
      return new Scene(self, seen, List.of(enemies), grudge, slot);
    }

    Scene at(Slot newSlot) {
      return new Scene(self, seen, remembered, grudge, Optional.of(newSlot));
    }

    Situation situation(long now, Role role) {
      var bodies = new ArrayList<CombatantView>();
      bodies.add(self);
      // A teammate across the map, so the bot is not its team's last survivor.
      bodies.add(combatant(9, RED, new Vec3(14.5, 1, 28.5)));
      bodies.addAll(seen);
      bodies.addAll(remembered);
      var memory = new HashMap<CombatantId, Sighting>();
      for (var enemy : remembered) {
        memory.put(enemy.id(), new Sighting(enemy.pos(), Vec3.ZERO, HIT, 0.9, false, true));
      }
      var board = Blackboard.open(RED, Strategy.RUSH);
      if (slot.isPresent()) {
        board =
            board.withPlan(
                new TeamPlan(
                    Optional.of(Strategy.RUSH),
                    Optional.empty(),
                    Optional.empty(),
                    List.of(),
                    0.5,
                    List.of(slot.orElseThrow()),
                    Map.of(self.id(), slot.orElseThrow().key()),
                    0,
                    Map.of(),
                    -1),
                0);
      }
      var snapshot =
          new WorldSnapshot(
              now,
              MatchPhase.LIVE,
              bodies,
              List.of(),
              PoisonView.NONE,
              NAV.mapId(),
              List.of(),
              List.of(),
              List.of());
      var percept =
          new Percept(
              new PerceptionState(new Memory(memory), Suspicion.NONE, -1, grudge), seen, now);
      return new Situation(self, snapshot, percept, board, role);
    }
  }

  private static Slot holding(Vec3 pos) {
    return new Slot(
        "anchor-0",
        SlotKind.ANCHOR,
        Role.DEFEND,
        pos,
        pos.plus(0, 0, 10),
        -1,
        -1,
        Optional.empty(),
        0);
  }

  private static TacticsContext context(Kit kit) {
    return new TacticsContext(
        NAV, levers(1), new Style(0.5, 0.5, 0.5, 0.5), kit, Archetype.TACTICIAN, Set.of(), 7, null);
  }

  private static Thought think(Situation situation, Kit kit) {
    return Tactics.think(TacticsState.fresh(0), situation, context(kit), new SplittableRandom(3));
  }

  private static Optional<Grudge> grudge(CombatantView attacker, Vec3 anchor) {
    return Optional.of(new Grudge(attacker.id(), HIT, anchor));
  }

  private static Optional<CombatantId> fighting(Thought thought) {
    return thought.state().plan().map(Plan::current).stream()
        .flatMap(
            step ->
                step instanceof PlanStep.Fight(var target)
                    ? java.util.stream.Stream.of(target)
                    : java.util.stream.Stream.empty())
        .findFirst();
  }

  @Test
  void aHolderShotFromThirtyBlocksTurnsToWatchTheShooter() {
    var self = combatant(1, RED, HOME);
    var shooter = combatant(2, BLUE, new Vec3(26.5, 1, 20.5));
    assertThat(shooter.pos().distance(self.pos())).isGreaterThan(29);

    var calm =
        think(
            new Scene(self, Optional.empty()).remembering(shooter).situation(NOW, Role.DEFEND),
            Kit.TROOPER);
    assertThat(calm.decision().watch()).hasValue(HOME.plus(0, 0, 10));

    var hit =
        think(
            new Scene(self, grudge(shooter, HOME)).remembering(shooter).situation(NOW, Role.DEFEND),
            Kit.TROOPER);
    assertThat(hit.trace().features()).contains(AGGRO);
    assertThat(hit.trace().choice())
        .as("a sword does not run thirty blocks after an archer")
        .isNotEqualTo(Option.ENGAGE);
    assertThat(hit.decision().watch()).hasValue(shooter.pos());
    assertThat(hit.decision().waypoints()).as("it stands and faces it").isEmpty();
  }

  @Test
  void anArcherAnswersTheShooterItCanSeeBeforeANearerBystander() {
    var self =
        combatant(1, RED, HOME)
            .withFacing(
                com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing.looking(
                    HOME, new Vec3(22.5, 1, 17.5)));
    var shooter = combatant(2, BLUE, new Vec3(22.5, 1, 17.5));
    var bystander = combatant(3, BLUE, new Vec3(18.5, 1, 14.5));
    assertThat(shooter.pos().distance(HOME))
        .isCloseTo(25, org.assertj.core.api.Assertions.within(0.1));
    assertThat(bystander.pos().distance(HOME))
        .isCloseTo(20, org.assertj.core.api.Assertions.within(0.1));
    var archer = context(Kit.LONGBOW);

    var calm =
        new Scene(self, Optional.empty()).seeing(bystander, shooter).situation(NOW, Role.DEFEND);
    assertThat(Planner.engageTarget(calm, archer)).contains(bystander.id());

    var hit =
        new Scene(self, grudge(shooter, HOME))
            .seeing(bystander, shooter)
            .situation(NOW, Role.DEFEND);
    assertThat(Planner.engageTarget(hit, archer)).contains(shooter.id());
    var thought = think(hit, Kit.LONGBOW);
    assertThat(thought.trace().features()).contains(AGGRO);
    assertThat(thought.trace().choice()).isEqualTo(Option.ENGAGE);
    assertThat(fighting(thought)).contains(shooter.id());

    var midFight =
        Tactics.think(
            new TacticsState(
                Optional.of(Plan.of(Option.ENGAGE, NOW - 5, new PlanStep.Fight(bystander.id()))),
                NOW - 5,
                0,
                0,
                RewindClock.UNSTARTED,
                TacticalMemory.EMPTY),
            hit,
            archer,
            new SplittableRandom(3));
    assertThat(fighting(midFight))
        .as("a fight under way turns to the shooter")
        .contains(shooter.id());
  }

  @Test
  void aSwordClosesOnItsAttackerInsideTheLeashButNotBeyond() {
    var self = combatant(1, RED, HOME);
    var inside = combatant(2, BLUE, HOME.plus(0, 0, 15));
    var calm =
        think(
            new Scene(self, Optional.empty()).remembering(inside).situation(NOW, Role.DEFEND),
            Kit.TROOPER);
    assertThat(calm.trace().choice()).isNotEqualTo(Option.ENGAGE);

    var hit =
        think(
            new Scene(self, grudge(inside, HOME)).remembering(inside).situation(NOW, Role.DEFEND),
            Kit.TROOPER);
    assertThat(hit.trace().choice()).isEqualTo(Option.ENGAGE);
    assertThat(fighting(hit)).contains(inside.id());

    var outside = combatant(2, BLUE, HOME.plus(0, 0, 25));
    var tooFar =
        think(
            new Scene(self, grudge(outside, HOME)).remembering(outside).situation(NOW, Role.DEFEND),
            Kit.TROOPER);
    assertThat(tooFar.trace().features()).contains(AGGRO);
    assertThat(tooFar.trace().choice()).isNotEqualTo(Option.ENGAGE);

    var strayed = combatant(1, RED, HOME.plus(0, 0, 24));
    var near = combatant(2, BLUE, HOME.plus(0, 0, 14));
    var leashed =
        think(
            new Scene(strayed, grudge(near, HOME)).remembering(near).situation(NOW, Role.DEFEND),
            Kit.TROOPER);
    assertThat(leashed.trace().features())
        .as("a bot that has run its leash out lets the grudge go")
        .doesNotContain(AGGRO);
    assertThat(leashed.trace().choice()).isNotEqualTo(Option.ENGAGE);
  }

  @Test
  void theGrudgeLapsesAfterItsWindow() {
    var self = combatant(1, RED, HOME);
    var attacker = combatant(2, BLUE, HOME.plus(0, 0, 15));
    var scene = new Scene(self, grudge(attacker, HOME)).remembering(attacker);
    var later = think(scene.situation(HIT + Grudge.WINDOW_TICKS + 1, Role.DEFEND), Kit.TROOPER);
    assertThat(later.trace().features()).doesNotContain(AGGRO);
    assertThat(later.trace().choice()).isNotEqualTo(Option.ENGAGE);
    assertThat(later.decision().watch()).hasValue(HOME.plus(0, 0, 10));
  }

  @Test
  void aBotLowOnHealthStillLooksAfterItselfFirst() {
    var self = combatant(1, RED, HOME).withHealth(4, 0);
    var attacker = combatant(2, BLUE, HOME.plus(0, 0, 3));
    var thought =
        think(
            new Scene(self, grudge(attacker, HOME)).seeing(attacker).situation(NOW, Role.DEFEND),
            Kit.TROOPER);
    assertThat(thought.trace().features()).contains(AGGRO);
    assertThat(thought.trace().choice()).isIn(Option.RETREAT, Option.HEAL, Option.REWIND);
  }

  @Test
  void aDefuserOnALitBombIsPulledOffOnlyByAnAttackerInMeleeRange() {
    var site = NAV.sites().bombs().getFirst();
    var bomb =
        new BombView(
            new BombId(1), new BombOwner.Team(RED), site.cell().center(), new BombState.Armed(400));
    var self = combatant(1, RED, Planner.approach(NAV, bomb));
    for (var distance : List.of(10.0, 2.5)) {
      var attacker = combatant(2, BLUE, self.pos().plus(distance, 0, 0));
      var scene =
          new Scene(
              self, List.of(attacker), List.of(), grudge(attacker, self.pos()), Optional.empty());
      var base = scene.situation(NOW, Role.RETAKE);
      var snapshot =
          new WorldSnapshot(
              NOW,
              MatchPhase.LIVE,
              base.snapshot().combatants(),
              List.of(bomb),
              PoisonView.NONE,
              NAV.mapId(),
              List.of(),
              List.of(),
              List.of());
      var situation = new Situation(self, snapshot, base.percept(), base.board(), Role.RETAKE);
      var thought = think(situation, Kit.TROOPER);
      if (distance > ObjectivePolicy.IMMEDIATE_MELEE) {
        assertThat(thought.trace().choice()).isEqualTo(Option.DEFUSE);
      } else {
        assertThat(thought.trace().choice()).isEqualTo(Option.ENGAGE);
        assertThat(fighting(thought)).contains(attacker.id());
      }
    }
  }

  @Test
  void aBotOnItsWayToASlotDoesNotWalkPastAnAttackerItSees() {
    var self = combatant(1, RED, HOME);
    var attacker = combatant(2, BLUE, HOME.plus(10, 0, 0));
    var flank =
        new Slot(
            "flank-0",
            SlotKind.FLANK,
            Role.ROTATE,
            new Vec3(25.5, 1, 15.5),
            new Vec3(28.5, 1, 15.5),
            -1,
            -1,
            Optional.empty(),
            0);
    var route =
        Optional.of(
            Plan.of(
                Option.TAKE_SLOT,
                NOW - 10,
                new PlanStep.Route(new Vec3(25.5, 1, 15.5), Stance.AGGRESSIVE)));
    var calm =
        new Scene(self, Optional.empty()).seeing(attacker).at(flank).situation(NOW, Role.ROTATE);
    assertThat(Tactics.choose(Option.ENGAGE, route, calm, Map.of())).isEqualTo(Option.TAKE_SLOT);
    var hit =
        new Scene(self, grudge(attacker, HOME))
            .seeing(attacker)
            .at(flank)
            .situation(NOW, Role.ROTATE);
    assertThat(Tactics.choose(Option.ENGAGE, route, hit, Map.of())).isEqualTo(Option.ENGAGE);
  }
}
