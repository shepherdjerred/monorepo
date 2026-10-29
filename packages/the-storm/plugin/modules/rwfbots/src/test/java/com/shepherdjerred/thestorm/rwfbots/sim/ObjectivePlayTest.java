package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Playbook;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Objective play on the training yard, whose open ground keeps the teams in sight of each other
 * from the first seconds: an even fight still sends the planter after a stalemate instead of
 * holding the line until one side is nearly wiped out, and a team two to one up rushes the plant
 * and hunts the rest.
 */
final class ObjectivePlayTest {

  /** When the planter of an even team must have been sent, in ticks. */
  private static final long PLANTER_SENT_BY = 600;

  /**
   * When the median even match must have seen its first attempt on a team bomb, in ticks (70 s
   * before stalled pushes moved). Main (ad7466e9f4) measures 1187 over the 128 matches below. A
   * median moves with any one chaotic match, so the ceiling is the one-sided 95% upper bound of
   * main's median: 10,000 bootstrap resamples of main's 128 first attempts (no attempt counted as
   * never, Python random.Random(20261028)), the median taken as here, rounded up to the tick. The
   * two-sided 95% interval is 1084 to 1299.
   */
  private static final long MEDIAN_ATTEMPT_BY = 1278;

  /** When a team two to one up must have started arming, in ticks. */
  private static final long CLOSER_ATTEMPT_BY = 800;

  /**
   * Per team: when it first started arming an enemy team's bomb, or any bomb at all (the nuke is an
   * objective too), and when it sent its planter.
   */
  private static final class Attempts {
    final Map<TeamId, Long> firstPlant = new HashMap<>();
    final Map<TeamId, Long> firstArm = new HashMap<>();
    final Map<TeamId, Long> planterSent = new HashMap<>();
    final Map<TeamId, Boolean> hunted = new HashMap<>();

    void observe(SimWorld world) {
      for (var bomb : world.bombs.values()) {
        if (bomb.phase == SimBomb.Phase.ARMING) {
          var team = bomb.armingTeam.orElseThrow();
          firstArm.putIfAbsent(team, world.tick);
          if (bomb.owner instanceof BombOwner.Team) firstPlant.putIfAbsent(team, world.tick);
        }
      }
      world.boards.forEach(
          (team, board) -> {
            if (board.plan().push() >= Playbook.PLANT_GO) {
              planterSent.putIfAbsent(team, world.tick);
            }
            if (board.plan().slots().stream().anyMatch(slot -> slot.kind() == SlotKind.SWEEP)) {
              hunted.put(team, true);
            }
          });
    }

    long first() {
      return firstPlant.values().stream().mapToLong(Long::longValue).min().orElse(Long.MAX_VALUE);
    }
  }

  @Test
  void evenTeamsInContactStillSendThePlanterAndAttemptAPlant() {
    var firsts = new ArrayList<Long>();
    var sent = new ArrayList<Long>();
    // 128 matches, so one chaotic match cannot flip a floor. Each floor is what main measures on
    // exactly this set, less at most one match.
    for (var seed = 30L; seed < 62; seed++) {
      for (var red : List.of(Strategy.RUSH, Strategy.SPLIT)) {
        for (var blue : List.of(Strategy.RUSH, Strategy.SPLIT)) {
          var world = Arenas.yard(seed, 8, red, blue);
          var attempts = new Attempts();
          world.run(
              2400,
              w -> {
                attempts.observe(w);
                return !attempts.firstPlant.isEmpty() && w.tick >= PLANTER_SENT_BY;
              });
          for (var team : List.of(RED, BLUE)) {
            sent.add(attempts.planterSent.getOrDefault(team, Long.MAX_VALUE));
          }
          firsts.add(attempts.first());
        }
      }
    }
    // Before stalled pushes moved, 18 of the first 64 teams never sent their planter at all; main
    // sends 232 of these 256 in time.
    assertThat(sent.stream().filter(tick -> tick <= PLANTER_SENT_BY).count())
        .as("teams that sent their planter within 30 s: %s", sent)
        .isGreaterThanOrEqualTo(230);
    var sorted = firsts.stream().sorted().toList();
    assertThat(sorted.get(sorted.size() / 2))
        .as("median first plant attempt of %s", firsts)
        .isLessThanOrEqualTo(MEDIAN_ATTEMPT_BY);
    assertThat(firsts.stream().filter(first -> first == Long.MAX_VALUE).count())
        .as("matches without a plant attempt in two minutes: %s", firsts)
        .isLessThanOrEqualTo(16);
  }

  @Test
  void defendersBesideTheirFuseDefuseWithThreeHands() {
    for (var seed = 50L; seed < 54; seed++) {
      var world = new SimWorld(Arenas.SYNTHETIC, seed);
      world.addBomb(0, RED, SyntheticMap.RED_BOMB);
      world.addBomb(1, BLUE, SyntheticMap.BLUE_BOMB);
      for (var i = 0; i < 3; i++) {
        world.addBot(
            new SimWorld.Spawn(
                i + 1, BLUE, Kit.TROOPER, SyntheticMap.BLUE_BOMB.offset(-2 - i, 0, 4).feet()),
            0.7);
      }
      world.addScripted(new SimWorld.Spawn(9, RED, Kit.TROOPER, SyntheticMap.RED_SPAWN.feet()));
      world.bomb(1).arm(0);
      var hands = new int[1];
      world.run(
          900,
          w -> {
            hands[0] = Math.max(hands[0], w.bomb(1).clickers.size());
            return w.bomb(1).phase == SimBomb.Phase.IDLE;
          });
      assertThat(world.bomb(1).phase)
          .as("seed %d defused by tick %d", seed, world.tick)
          .isEqualTo(SimBomb.Phase.IDLE);
      assertThat(hands[0]).as("seed %d hands on the fuse", seed).isEqualTo(3);
    }
  }

  @Test
  void aTeamTwoToOneUpRushesThePlantAndHunts() {
    var firsts = new ArrayList<Long>();
    var hunted = new ArrayList<Boolean>();
    // 48 matches: main sends pairs hunting in all 48 and starts arming in 35 within 40 s. Each
    // floor allows one chaotic match below that.
    for (var seed = 40L; seed < 88; seed++) {
      var world = Arenas.yard(seed, 8, Strategy.TURTLE, Strategy.TURTLE);
      world.bodies.values().stream()
          .filter(body -> body.team.equals(BLUE))
          .skip(4)
          .forEach(body -> body.hurt(1000, 0));
      var attempts = new Attempts();
      world.run(
          (int) CLOSER_ATTEMPT_BY + 1,
          w -> {
            attempts.observe(w);
            return attempts.firstArm.containsKey(RED);
          });
      hunted.add(attempts.hunted.getOrDefault(RED, false));
      firsts.add(attempts.firstArm.getOrDefault(RED, Long.MAX_VALUE));
    }
    assertThat(hunted.stream().filter(value -> value).count())
        .as("eight against four sent pairs hunting: %s", hunted)
        .isGreaterThanOrEqualTo(47);
    assertThat(firsts.stream().filter(tick -> tick <= CLOSER_ATTEMPT_BY).count())
        .as("eight against four started arming: %s", firsts)
        .isGreaterThanOrEqualTo(34);
  }
}
