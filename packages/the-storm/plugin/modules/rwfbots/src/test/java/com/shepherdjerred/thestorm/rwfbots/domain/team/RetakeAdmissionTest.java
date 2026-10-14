package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Planner;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Situation;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.TacticsContext;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

final class RetakeAdmissionTest {
  private static final NavArtifact DROP = course(false);
  private static final NavArtifact GAP = course(true);
  private static final NavArtifact LADDER = course(true, true);

  private static NavArtifact course(boolean gap) {
    return course(gap, false);
  }

  private static NavArtifact course(boolean gap, boolean ladder) {
    var spawn = new BlockPos(2, gap ? 1 : 9, 2);
    var bomb = new BlockPos(9, 1, 2);
    var terrain =
        new BlockClassification() {
          @Override
          public GridBounds bounds() {
            return new GridBounds(new BlockPos(0, 0, 0), 12, 12, 5);
          }

          @Override
          public BlockShape shape(int x, int y, int z) {
            if (ladder && x == 8 && y >= 1 && y <= 4 && z == 2) return BlockShape.LADDER;
            var floor = gap ? y == 0 && (x <= 3 || x >= 6) : y == 0 || (x <= 3 && y <= 8);
            return floor || bomb.equals(new BlockPos(x, y, z))
                ? BlockShape.FULL
                : BlockShape.PASSABLE;
          }

          @Override
          public boolean blocksSight(int x, int y, int z) {
            return shape(x, y, z).blocksMovement();
          }
        };
    return MapBaker.bake(
        gap ? "worker-gap" : "worker-drop",
        terrain,
        new NavSites(
            List.of(
                new NavSites.Site("red-spawn", Optional.of("red"), spawn),
                new NavSites.Site("blue-spawn", Optional.of("blue"), new BlockPos(10, 1, 2))),
            List.of(new NavSites.Site("red-bomb", Optional.of("red"), bomb))));
  }

  private static CombatantView bot(NavArtifact nav, int id) {
    return Fixtures.combatant(id, Fixtures.RED, nav.sites().spawns().getFirst().cell().feet());
  }

  private static WorldSnapshot world(NavArtifact nav, long tick, List<CombatantView> bots) {
    return new WorldSnapshot(
        tick,
        MatchPhase.LIVE,
        bots,
        List.of(
            new BombView(
                new BombId(0),
                new BombOwner.Team(Fixtures.RED),
                nav.sites().bombs().getFirst().cell().center(),
                new BombState.Armed(200))),
        PoisonView.NONE,
        nav.mapId(),
        List.of());
  }

  private static Blackboard board(NavArtifact nav, List<CombatantView> bots) {
    var bomb = world(nav, 0, bots).bombs().getFirst();
    var worker = nav.bombScreens().require("red-bomb").workers().getFirst();
    var slots = new ArrayList<Slot>();
    var assigned = new HashMap<CombatantId, String>();
    for (var index = 0; index < bots.size(); index++) {
      var key = index == 0 ? "defuse-0" : "screen-" + index;
      slots.add(
          new Slot(
              key,
              SlotKind.ANCHOR,
              index == 0 ? Role.RETAKE : Role.DEFEND,
              nav.graph().feet(worker),
              bomb.pos(),
              -1,
              -1,
              Optional.empty(),
              0));
      assigned.put(bots.get(index).id(), key);
    }
    return Blackboard.open(Fixtures.RED, Strategy.RUSH)
        .withPlan(
            new TeamPlan(
                Optional.of(Strategy.RUSH),
                Optional.empty(),
                Optional.of(bomb.id()),
                List.of(),
                0,
                slots,
                assigned,
                0),
            0);
  }

  private static RetakeAdmission.Result verify(
      NavArtifact nav, RetakeAdmission.Result previous, WorldSnapshot world) {
    var context =
        new TacticsContext(
            nav,
            Fixtures.levers(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.TACTICIAN,
            Set.of(),
            7,
            nav.graph().workspace());
    var routes =
        new RetakeAdmission.Routes() {
          @Override
          public List<CombatantId> candidates(Slot worker) {
            return world.combatants().stream().map(CombatantView::id).sorted().toList();
          }

          @Override
          public boolean reachable(CombatantId id, Slot worker, Blackboard provisional) {
            return Planner.canReachWorker(
                new Situation(
                    world.require(id),
                    world,
                    new Percept(PerceptionState.EMPTY, List.of(), world.tick()),
                    provisional,
                    Role.RETAKE),
                context,
                worker);
          }
        };
    return RetakeAdmission.verify(
        previous.board(), previous.state(), new RetakeAdmission.Context(nav, world), routes);
  }

  private static RetakeAdmission.Result initial(NavArtifact nav, List<CombatantView> bots) {
    return new RetakeAdmission.Result(
        board(nav, bots), RetakeAdmission.State.EMPTY, RetakeAdmission.Status.NOT_NEEDED, 0);
  }

  @Test
  void lowHealthWorkerYieldsToACapableScreenUsingTheActualPlanner() {
    var bots = List.of(bot(DROP, 1).withHealth(5, 0), bot(DROP, 2));
    var result = verify(DROP, initial(DROP, bots), world(DROP, 0, bots));
    assertThat(result.status()).isEqualTo(RetakeAdmission.Status.ADMITTED);
    assertThat(result.board().holders(Role.RETAKE)).containsExactly(bots.get(1).id());
    assertThat(result.board().roleOf(bots.getFirst().id())).contains(Role.DEFEND);
    assertThat(result.queries()).isEqualTo(2);
  }

  @Test
  void noSprintIncumbentAndFirstReplacementCannotBlockALowerRankedCapableWorker() {
    var restricted = new TraversalState(false, 3, 1, 0, -1, -1, -1, -1, 0, -1, -1, -1, -1, 20, 0);
    var bots =
        List.of(
            bot(GAP, 1).withTraversal(restricted),
            bot(GAP, 2).withTraversal(restricted),
            bot(GAP, 3));
    var result = verify(GAP, initial(GAP, bots), world(GAP, 0, bots));
    assertThat(result.board().holders(Role.RETAKE)).containsExactly(bots.get(2).id());
    assertThat(result.queries()).isEqualTo(3);
  }

  @Test
  void previouslyAdmittedAliveWorkerIsReplacedAfterHealthLossOrProtectionExpiry() {
    var protectedBody =
        new TraversalState(true, 3, 1, 0, -1, -1, 1000, -1, 0, -1, -1, -1, -1, 20, 0);
    var bots = List.of(bot(DROP, 1).withTraversal(protectedBody).withHealth(5, 0), bot(DROP, 2));
    var admitted = verify(DROP, initial(DROP, bots), world(DROP, 0, bots));
    assertThat(admitted.board().holders(Role.RETAKE)).containsExactly(bots.getFirst().id());
    var expired = verify(DROP, admitted, world(DROP, 1001, bots));
    assertThat(admitted.state().invalidated(world(DROP, 1001, bots))).isTrue();
    assertThat(expired.board().holders(Role.RETAKE)).containsExactly(bots.get(1).id());
    var healthy = List.of(bot(DROP, 1), bot(DROP, 2));
    var first = verify(DROP, initial(DROP, healthy), world(DROP, 0, healthy));
    var injured = List.of(healthy.getFirst().withHealth(5, 0), healthy.get(1));
    var replacement = verify(DROP, first, world(DROP, 1, injured));
    assertThat(first.state().invalidated(world(DROP, 1, injured))).isTrue();
    assertThat(replacement.board().holders(Role.RETAKE)).containsExactly(healthy.get(1).id());
  }

  @Test
  void noCapableWorkerLeavesNoAliveRetakeReservationAndCanRecoverWithoutARoleRedeal() {
    var bots = List.of(bot(DROP, 1).withHealth(5, 0));
    var failed = verify(DROP, initial(DROP, bots), world(DROP, 0, bots));
    assertThat(failed.status()).isEqualTo(RetakeAdmission.Status.NO_CAPABLE_WORKER);
    assertThat(failed.board().holders(Role.RETAKE)).isEmpty();
    assertThat(failed.board().roleOf(bots.getFirst().id())).contains(Role.ROTATE);
    var recovered = verify(DROP, failed, world(DROP, 1, List.of(bot(DROP, 1))));
    assertThat(recovered.board().holders(Role.RETAKE)).containsExactly(bots.getFirst().id());
    assertThat(recovered.board().rolesAssignedTick()).isZero();
  }

  @Test
  void arrivingAtTheActualCertifiedStationRetainsAdmissionDespiteZeroMovementWaypoints() {
    var worker = DROP.bombScreens().require("red-bomb").workers().getFirst();
    var self = bot(DROP, 1).withPos(DROP.graph().feet(worker)).withHealth(1, 0);
    var bots = List.of(self);
    var arrived = verify(DROP, initial(DROP, bots), world(DROP, 0, bots));
    assertThat(arrived.board().holders(Role.RETAKE)).containsExactly(self.id());
    assertThat(arrived.queries()).isEqualTo(1);
    var airborne = List.of(self.withMotion(false, false));
    var unsupported = verify(DROP, arrived, world(DROP, 1, airborne));
    assertThat(unsupported.board().holders(Role.RETAKE)).isEmpty();
    assertThat(unsupported.status()).isEqualTo(RetakeAdmission.Status.NO_CAPABLE_WORKER);
  }

  @Test
  void approximateGroundFlagCannotDiscardUnpaidLandingDamageAtOneHealth() {
    var worker = DROP.bombScreens().require("red-bomb").workers().getFirst();
    var self =
        bot(DROP, 1)
            .withPos(DROP.graph().feet(worker).plus(0, 0.03, 0))
            .withTraversal(TraversalState.UNMODIFIED.withFallDistance(8))
            .withHealth(1, 0);
    assertThat(self.onGround()).isTrue();
    var bots = List.of(self);
    var result = verify(DROP, initial(DROP, bots), world(DROP, 0, bots));
    assertThat(result.board().holders(Role.RETAKE)).isEmpty();
    assertThat(result.status()).isEqualTo(RetakeAdmission.Status.NO_CAPABLE_WORKER);
  }

  @Test
  void merelySharingACertifiedClimbNodeDoesNotProveActualLadderAttachment() {
    var node = LADDER.graph().nodeAt(new BlockPos(8, 1, 2)).orElseThrow();
    assertThat(LADDER.bombScreens().require("red-bomb").workers()).contains(node);
    assertThat(
            IntStream.range(LADDER.graph().edgeStart(node), LADDER.graph().edgeEnd(node))
                .anyMatch(edge -> LADDER.graph().edgeHop(edge) == Hop.CLIMB))
        .isTrue();
    var self = bot(LADDER, 1).withPos(LADDER.graph().feet(node)).withMotion(false, false);
    var original = initial(LADDER, List.of(self));
    var plan = original.board().plan();
    var station = plan.slots().getFirst();
    var corrected =
        new Slot(
            station.key(),
            station.kind(),
            station.role(),
            LADDER.graph().feet(node),
            station.watch(),
            station.lane(),
            station.pair(),
            station.bomb(),
            station.side());
    var board =
        original
            .board()
            .withPlan(
                new TeamPlan(
                    plan.strategy(),
                    plan.home(),
                    plan.objective(),
                    plan.lanes(),
                    plan.push(),
                    List.of(corrected),
                    plan.assignment(),
                    plan.dealtTick()),
                0);
    var pending =
        new RetakeAdmission.Result(
            board, RetakeAdmission.State.EMPTY, RetakeAdmission.Status.NOT_NEEDED, 0);
    var result = verify(LADDER, pending, world(LADDER, 0, List.of(self)));
    assertThat(result.board().holders(Role.RETAKE)).isEmpty();
    assertThat(result.status()).isEqualTo(RetakeAdmission.Status.NO_CAPABLE_WORKER);
  }

  @Test
  void largeRosterSearchBudgetIsFixedAndRotatingShortlistEventuallyFindsTheLastCandidate() {
    var bots = IntStream.rangeClosed(1, 256).mapToObj(id -> bot(DROP, id)).toList();
    var snapshot = world(DROP, 0, bots);
    var routes =
        new RetakeAdmission.Routes() {
          @Override
          public List<CombatantId> candidates(Slot worker) {
            return bots.stream().map(CombatantView::id).toList();
          }

          @Override
          public boolean reachable(CombatantId id, Slot worker, Blackboard provisional) {
            return id.equals(bots.getLast().id());
          }
        };
    var result = initial(DROP, bots);
    for (var step = 0; step < 86; step++) {
      result =
          RetakeAdmission.verify(
              result.board(), result.state(), new RetakeAdmission.Context(DROP, snapshot), routes);
      assertThat(result.queries()).isLessThanOrEqualTo(RetakeAdmission.MAX_QUERIES);
      assertThat(result.board().plan().assignment()).hasSize(256);
      if (!result.board().holders(Role.RETAKE).isEmpty()) break;
    }
    assertThat(result.board().holders(Role.RETAKE)).containsExactly(bots.getLast().id());
  }

  @Test
  void impossibleFirstStationCannotStarveSecondStationAcrossRepeatedRoleRedeals() {
    var bots = IntStream.rangeClosed(1, 16).mapToObj(id -> bot(DROP, id)).toList();
    var original = board(DROP, bots);
    var slots = new ArrayList<>(original.plan().slots());
    var second = slots.get(1);
    var worker = DROP.bombScreens().require("red-bomb").workers().get(1);
    slots.set(
        1,
        new Slot(
            second.key(),
            second.kind(),
            Role.RETAKE,
            DROP.graph().feet(worker),
            second.watch(),
            -1,
            -1,
            Optional.empty(),
            0));
    var routes =
        new RetakeAdmission.Routes() {
          @Override
          public List<CombatantId> candidates(Slot station) {
            return bots.stream().map(CombatantView::id).toList();
          }

          @Override
          public boolean reachable(CombatantId id, Slot station, Blackboard provisional) {
            return station.key().equals(second.key()) && id.equals(bots.getLast().id());
          }
        };
    var state = RetakeAdmission.State.EMPTY;
    RetakeAdmission.Result result = initial(DROP, bots);
    for (var step = 0; step < 20; step++) {
      var plan = original.plan();
      var redealt =
          original.withPlan(
              new TeamPlan(
                  plan.strategy(),
                  plan.home(),
                  plan.objective(),
                  plan.lanes(),
                  plan.push(),
                  slots,
                  plan.assignment(),
                  step * 40L),
              step * 40L);
      result =
          RetakeAdmission.verify(
              redealt,
              state,
              new RetakeAdmission.Context(DROP, world(DROP, step * 40L, bots)),
              routes);
      state = result.state();
      assertThat(result.queries()).isLessThanOrEqualTo(4);
      assertThat(result.board().plan().slot("defuse-0").orElseThrow().role())
          .isEqualTo(Role.ROTATE);
      if (!result.board().holders(Role.RETAKE).isEmpty()) break;
    }
    assertThat(result.board().holders(Role.RETAKE)).containsExactly(bots.getLast().id());
    assertThat(result.board().plan().slotOf(bots.getLast().id()).orElseThrow().key())
        .isEqualTo(second.key());
  }
}
