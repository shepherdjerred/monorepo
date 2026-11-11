package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.StreakPlay;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CrateView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** A carried supply crate is called from safety, and a landed one is looted when the rights allow. */
final class CratePlayTest {
  private static final NavArtifact NAV = SyntheticMap.bake();
  private static final TacticsContext CONTEXT =
      new TacticsContext(
          NAV,
          levers(0.5),
          new Style(0.5, 0.5, 0.5, 0.5),
          Kit.TRACKER,
          Archetype.TACTICIAN,
          java.util.Set.of(),
          42,
          null);
  private static final long NOW = 2_000;
  private static final Vec3 AT = new Vec3(9.5, 1, 24.5);

  @Test
  void theOwnerLootsImmediatelyAndATeammateWaitsOutTheGrace() {
    assertThat(loot(RED, 1, RED, 1, 0)).isPresent();
    assertThat(loot(RED, 1, RED, 9, 0)).isEmpty();
    assertThat(loot(RED, 1, RED, 9, 580)).isEmpty();
    assertThat(loot(RED, 1, RED, 9, 600)).isPresent();
  }

  @Test
  void anEnemyWaitsTheFullMinuteThenAnyoneMaySteal() {
    assertThat(loot(BLUE, 1, RED, 9, 1_180)).isEmpty();
    var stolen = loot(BLUE, 1, RED, 9, 1_200).orElseThrow();
    assertThat(stolen.kind()).isEqualTo(CratePlay.Kind.LOOT);
  }

  @Test
  void anOwnCrateComesBeforeACloserSteal() {
    var self = combatant(1, RED, AT.plus(4, 0, 0));
    var own = new CrateView(AT, self.id(), RED, NOW);
    var steal = new CrateView(AT.plus(3, 0, 0), new CombatantId(9), BLUE, NOW - 1_200);
    var trip = trip(self, List.of(self), List.of(own, steal), List.of(), List.of()).orElseThrow();
    assertThat(trip.kind()).isEqualTo(CratePlay.Kind.LOOT);
    assertThat(trip.cell().distance(own.pos())).isLessThan(trip.cell().distance(steal.pos()));
  }

  @Test
  void theNearestTeammateClaimsTheCrate() {
    var near = combatant(1, RED, AT.plus(1, 0, 0));
    var far = combatant(2, RED, AT.plus(10, 0, 0));
    var owner = combatant(9, RED, AT.plus(0, 0, 40));
    var crate = new CrateView(AT, owner.id(), RED, NOW - 600);
    var mates = List.of(near, far, owner);
    assertThat(trip(near, mates, List.of(crate), List.of(), List.of())).isPresent();
    assertThat(trip(far, mates, List.of(crate), List.of(), List.of())).isEmpty();
  }

  @Test
  void aCarrierUnderThreatWalksToACellWithNoEnemyNearby() {
    var self = combatant(1, RED, AT);
    var enemy = combatant(2, BLUE, AT.plus(5, 0, 0));
    var trip =
        trip(self, List.of(self, enemy), List.of(), List.of(self.id()), List.of(enemy))
            .orElseThrow();
    assertThat(trip.kind()).isEqualTo(CratePlay.Kind.CALL);
    assertThat(trip.cell().distance(self.pos())).isLessThanOrEqualTo(CratePlay.SEARCH);
    assertThat(trip.cell().distance(enemy.pos())).isGreaterThan(CratePlay.NEARBY);
  }

  @Test
  void aCarrierAlreadyInTheClearDoesNotDetour() {
    var self = combatant(1, RED, AT);
    assertThat(trip(self, List.of(self), List.of(), List.of(self.id()), List.of())).isEmpty();
  }

  @Test
  void aBombColumnIsNotAPlaceToCallACrate() {
    var self = combatant(1, RED, AT);
    var bomb = new BombView(new BombId(0), new BombOwner.Team(BLUE), AT, new BombState.Idle());
    var snapshot = world(List.of(self), List.of(), List.of(), List.of(bomb));
    var input = input(self, snapshot, List.of());
    assertThat(CratePlay.safeToCall(self, List.of(), Optional.empty(), snapshot.bombs()))
        .isFalse();
    assertThat(CratePlay.safeToCall(self, List.of(), Optional.empty(), List.of())).isTrue();
    assertThat(input.self().onGround()).isTrue();
  }

  @Test
  void aLitFuseOutranksACrate() {
    var self = combatant(1, RED, AT);
    var bomb =
        new BombView(new BombId(0), new BombOwner.Team(RED), AT.plus(6, 0, 0), new BombState.Armed(200));
    var crate = new CrateView(AT, self.id(), RED, NOW);
    assertThat(trip(self, List.of(self), List.of(crate), List.of(), List.of(), List.of(bomb)))
        .isEmpty();
  }

  @Test
  void anEnemyStandingOnTheCrateKeepsTheBotOffIt() {
    var self = combatant(1, RED, AT.plus(2, 0, 0));
    var enemy = combatant(2, BLUE, AT);
    var crate = new CrateView(AT, self.id(), RED, NOW);
    assertThat(trip(self, List.of(self, enemy), List.of(crate), List.of(), List.of(enemy)))
        .isEmpty();
  }

  @Test
  void aSupplyCrateWaitsForSafetyAndOtherStreaksDoNot() {
    var self = combatant(1, RED, AT);
    var input = input(self, world(List.of(self), List.of(), List.of(), List.of()), List.of());
    assertThat(StreakPlay.now(1, input, 0, true, false)).isFalse();
    assertThat(StreakPlay.now(1, input, 0, true, true)).isTrue();
    assertThat(StreakPlay.now(1, input, 0, false, false)).isTrue();
  }

  @Test
  void aDiamondChestplateInTheBagGoesOn() {
    assertThat(CratePlay.wearChestplate(false, true)).isTrue();
    assertThat(CratePlay.wearChestplate(true, true)).isFalse();
    assertThat(CratePlay.wearChestplate(false, false)).isFalse();
  }

  @Test
  void waitingOnACrateFightsThenLootsAndDropsACrateThatVanished() {
    assertThat(CratePlay.attention(10, 5, false, false, false, false))
        .isEqualTo(CratePlay.Attention.CLEAR);
    assertThat(CratePlay.attention(3, 10, false, true, false, false))
        .isEqualTo(CratePlay.Attention.CLEAR);
    assertThat(CratePlay.attention(3, 10, true, true, true, true))
        .isEqualTo(CratePlay.Attention.FIGHT);
    assertThat(CratePlay.attention(3, 10, false, true, true, true))
        .isEqualTo(CratePlay.Attention.LOOT);
    assertThat(CratePlay.attention(3, 10, false, true, true, false))
        .isEqualTo(CratePlay.Attention.APPROACH);
    assertThat(CratePlay.attention(3, 10, false, false, false, false))
        .isEqualTo(CratePlay.Attention.HOLD);
  }

  @Test
  void theTripIsACautiousRouteRatherThanAPickup() {
    var trip = loot(RED, 1, RED, 1, 0).orElseThrow();
    var plan = CratePlay.plan(NOW, trip);
    assertThat(plan.option()).isEqualTo(Option.CRATE);
    assertThat(plan.current()).isInstanceOf(PlanStep.Route.class);
  }

  private static Optional<CratePlay.Trip> loot(
      TeamId selfTeam, int selfId, TeamId ownerTeam, int ownerId, long age) {
    var self = combatant(selfId, selfTeam, AT.plus(2, 0, 0));
    var owner = selfId == ownerId ? self : combatant(ownerId, ownerTeam, AT.plus(0, 0, 40));
    var views = new ArrayList<CombatantView>();
    views.add(self);
    if (!owner.id().equals(self.id())) {
      views.add(owner);
    }
    var crate = new CrateView(AT, new CombatantId(ownerId), ownerTeam, NOW - age);
    return trip(self, views, List.of(crate), List.of(), List.of());
  }

  private static Optional<CratePlay.Trip> trip(
      CombatantView self,
      List<CombatantView> mates,
      List<CrateView> crates,
      List<CombatantId> carriers,
      List<CombatantView> visible) {
    return trip(self, mates, crates, carriers, visible, List.of());
  }

  private static Optional<CratePlay.Trip> trip(
      CombatantView self,
      List<CombatantView> mates,
      List<CrateView> crates,
      List<CombatantId> carriers,
      List<CombatantView> visible,
      List<BombView> bombs) {
    var situation = situation(self, mates, crates, carriers, visible, bombs);
    return CratePlay.trip(
        situation, Features.of(situation, CONTEXT, Optional.empty(), false), CONTEXT, TacticalMemory.EMPTY);
  }

  private static Situation situation(
      CombatantView self,
      List<CombatantView> mates,
      List<CrateView> crates,
      List<CombatantId> carriers,
      List<CombatantView> visible,
      List<BombView> bombs) {
    return new Situation(
        self,
        world(mates, crates, carriers, bombs),
        new Percept(PerceptionState.EMPTY, visible, NOW),
        Blackboard.open(self.team(), Strategy.TURTLE),
        Role.ROTATE);
  }

  private static WorldSnapshot world(
      List<CombatantView> mates,
      List<CrateView> crates,
      List<CombatantId> carriers,
      List<BombView> bombs) {
    return new WorldSnapshot(
        NOW,
        MatchPhase.LIVE,
        mates,
        bombs,
        PoisonView.NONE,
        NAV.mapId(),
        List.of(),
        List.of(),
        List.of(),
        crates,
        carriers);
  }

  private static ReflexInput input(
      CombatantView self, WorldSnapshot snapshot, List<CombatantView> visible) {
    return ReflexInput.of(
        self,
        snapshot,
        Decision.idle(self.id(), snapshot.tick(), 0),
        new Percept(PerceptionState.EMPTY, visible, snapshot.tick()));
  }
}
