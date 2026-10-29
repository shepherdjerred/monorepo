package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TrainingYardNav;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
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
 * A team that defuses the nuke keeps a guard beside it, and arms it for itself when it is ahead; a
 * team that armed it keeps a guard on its fuse. In prod (1020-bf0e) lone bots armed and defused one
 * nuke twelve times over five and a half minutes, each defuser walking off to its strategy's bomb.
 */
final class NukeHoldTest {

  private static final NavArtifact NAV = TrainingYardNav.NAV;
  private static final BombId NUKE = new BombId(2);

  private static Vec3 nukePos() {
    return NAV.sites().bombs().stream()
        .filter(site -> site.team().isEmpty())
        .findFirst()
        .orElseThrow()
        .cell()
        .center();
  }

  private static List<BombView> bombs(BombOwner.Nuke nuke, BombState state) {
    var out = new ArrayList<BombView>();
    var id = 0;
    for (var site : NAV.sites().bombs()) {
      if (site.team().isPresent()) {
        out.add(
            new BombView(
                new BombId(id++),
                new BombOwner.Team(new TeamId(site.team().orElseThrow())),
                site.cell().center(),
                new BombState.Idle()));
      }
    }
    out.add(new BombView(NUKE, nuke, nukePos(), state));
    return out;
  }

  /** {@code reds} red bots beside the nuke and {@code blues} blue players at blue's spawn. */
  private static WorldSnapshot world(long tick, int reds, int blues, List<BombView> bombs) {
    var everyone = new ArrayList<CombatantView>();
    for (var i = 0; i < reds; i++) {
      everyone.add(Fixtures.combatant(i + 1, RED, nukePos().plus(2 + 3 * i, -0.5, 0)));
    }
    var blueSpawn = NAV.sites().spawns().getLast().cell().feet();
    for (var i = 0; i < blues; i++) {
      everyone.add(Fixtures.combatant(50 + i, BLUE, blueSpawn));
    }
    return new WorldSnapshot(
        tick,
        MatchPhase.LIVE,
        everyone,
        bombs,
        PoisonView.NONE,
        NAV.mapId(),
        List.of(),
        List.of(),
        List.of());
  }

  private static Blackboard step(Blackboard board, WorldSnapshot world) {
    var bots = world.alive(RED);
    var members = new HashMap<CombatantId, SlotFit.Member>();
    for (var bot : bots) {
      members.put(
          bot.id(),
          new SlotFit.Member(
              Archetype.RUSHER, Set.of(), Map.of(Role.PLANT, 1.0, Role.ESCORT, 0.8), Kit.TROOPER));
    }
    return TeamBrain.tick(
        board, new TeamBrain.TeamSituation(NAV, world, bots, members), new SplittableRandom(3));
  }

  /** Red's plan once it has retaken and defused the nuke Blue armed. */
  private static TeamPlan afterDefusing(int reds, int blues) {
    return defused(reds, blues).plan();
  }

  /** Red's board once it has retaken and defused the nuke Blue armed. */
  private static Blackboard defused(int reds, int blues) {
    var retake =
        step(
            Blackboard.open(RED, Strategy.RUSH),
            world(
                0,
                reds,
                blues,
                bombs(new BombOwner.Nuke(Optional.of(BLUE)), new BombState.Armed(600))));
    assertThat(retake.plan().objective()).contains(NUKE);
    return step(
        retake,
        world(
            TeamBrain.ROLE_PERIOD_TICKS,
            reds,
            blues,
            bombs(new BombOwner.Nuke(Optional.empty()), new BombState.Idle())));
  }

  private static Optional<Slot> hold(TeamPlan plan) {
    return plan.slot(Playbook.HOLD);
  }

  @Test
  void aLoneDefuserEvenWithTheEnemyStaysAsTheNukesGuard() {
    var plan = afterDefusing(1, 1);
    assertThat(plan.slots()).hasSize(1);
    var guard = hold(plan).orElseThrow();
    assertThat(guard.bomb()).contains(NUKE);
    assertThat(guard.pos().distance(nukePos())).isLessThanOrEqualTo(Playbook.HOME_HOLD);
    assertThat(plan.objective()).isNotEqualTo(Optional.of(NUKE));
  }

  @Test
  void aDefuserWellAheadArmsTheNukeForItsOwnSide() {
    var plan = afterDefusing(4, 2);
    assertThat(plan.objective()).contains(NUKE);
    var planter = plan.slot("plant-0").orElseThrow();
    assertThat(planter.bomb()).contains(NUKE);
    assertThat(planter.pos().distance(nukePos())).isLessThan(Playbook.HOME_HOLD);
    assertThat(hold(plan)).isPresent();
  }

  @Test
  void aSideOneUpOrEvenKeepsItsStrategysObjectiveAndAGuard() {
    for (var blues : List.of(3, 2)) {
      var plan = afterDefusing(3, blues);
      assertThat(plan.objective()).as("3 v %d", blues).isNotEqualTo(Optional.of(NUKE));
      assertThat(hold(plan)).as("3 v %d", blues).isPresent();
    }
  }

  /** A Blue player seen beside the nuke at {@code tick}. */
  private static Blackboard seen(Blackboard board, long tick) {
    var at = nukePos().plus(6, -0.5, 0);
    return board.share(
        List.of(
            new SharedSighting(new CombatantId(50), at, Vec3.ZERO, tick, tick, new CombatantId(1))),
        1,
        tick,
        new SplittableRandom(5));
  }

  @Test
  void theGuardHoldsAnIdleNukeAndStandsOnItsFuseWhileTheEnemyComes() {
    var defused = defused(2, 2);
    assertThat(hold(defused.plan())).isPresent();
    var idle = bombs(new BombOwner.Nuke(Optional.empty()), new BombState.Idle());
    var tick = 3L * TeamBrain.ROLE_PERIOD_TICKS;
    var contested = step(seen(defused, tick), world(tick, 2, 2, idle));
    assertThat(hold(contested.plan())).as("an enemy beside it").isPresent();
    var quiet = step(defused, world(tick, 2, 2, idle));
    assertThat(hold(quiet.plan())).as("nobody about, still idle").isPresent();
    // Armed by Red, with Blue coming: a guard stands on the fuse.
    var later = 5L * TeamBrain.ROLE_PERIOD_TICKS;
    var lit = bombs(new BombOwner.Nuke(Optional.of(RED)), new BombState.Armed(900));
    var armed = step(seen(quiet, later), world(later, 2, 2, lit));
    assertThat(hold(armed.plan()).flatMap(Slot::bomb)).contains(NUKE);
    assertThat(hold(step(quiet, world(later, 2, 3, lit)).plan())).as("nobody coming").isEmpty();
    assertThat(hold(step(quiet, world(later, 2, 2, lit)).plan()))
        .as("the enemy down to its last two, seen or not")
        .isPresent();
  }

  @Test
  void aNukeNobodyHeldNeedsNoGuard() {
    var plan =
        step(
                Blackboard.open(RED, Strategy.RUSH),
                world(0, 2, 2, bombs(new BombOwner.Nuke(Optional.empty()), new BombState.Idle())))
            .plan();
    assertThat(hold(plan)).isEmpty();
  }
}
