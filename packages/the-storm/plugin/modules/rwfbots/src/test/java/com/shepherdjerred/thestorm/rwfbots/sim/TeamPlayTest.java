package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Team play in the headless sim, on the shipped training yard (an open box: spreading must come
 * from the bots) and on the synthetic arena: teams spread out over the opening instead of walking
 * one path in a clump, rushes and splits use more than one lane, bots that see an enemy get into
 * cover they claimed, and archetypes fight at different ranges.
 */
final class TeamPlayTest {

  private static final long[] SEEDS = {1, 2, 3, 4, 5, 6};

  /** The most of the opening a team may spend with a crowd of four in one spot. */
  private static final double MAX_CROWDED_SHARE = 0.01;

  private static Watch play(SimWorld world, int ticks) {
    var watch = new Watch(world);
    world.run(ticks, watch::observe);
    return watch;
  }

  /** How far a team spreads over the opening of every strategy and seed. */
  private record Spread(List<Double> nearest, int teamTicks, int crowded, int maxCrowd) {}

  private static Spread spread(boolean yard) {
    var nearest = new ArrayList<Double>();
    var teamTicks = 0;
    var crowded = 0;
    var maxCrowd = 0;
    for (var strategy : Strategy.values()) {
      for (var seed : SEEDS) {
        var world =
            yard
                ? Arenas.yard(seed, 8, strategy, Strategy.RUSH)
                : Arenas.synthetic(seed, 4, strategy, Strategy.SPLIT);
        var watch = play(world, (int) Watch.OPENING_TICKS);
        nearest.addAll(watch.nearest(RED));
        nearest.addAll(watch.nearest(BLUE));
        teamTicks += watch.teamTicks();
        crowded += watch.crowdedTeamTicks();
        maxCrowd = Math.max(maxCrowd, watch.maxCrowd());
      }
    }
    return new Spread(nearest, teamTicks, crowded, maxCrowd);
  }

  private static void assertSpread(Spread spread, String map) {
    assertThat(Watch.mean(spread.nearest()))
        .as("%s: mean nearest teammate over the first 20 s, every strategy", map)
        .isGreaterThanOrEqualTo(4);
    // A crowd of four only ever passes through: a doorway, a fuse, a scrum, never a formation.
    assertThat((double) spread.crowded() / spread.teamTicks())
        .as(
            "%s: share of the opening with more than 3 teammates within 2 blocks of one (worst %d)",
            map, spread.maxCrowd())
        .isLessThanOrEqualTo(MAX_CROWDED_SHARE);
  }

  @Test
  void teamsSpreadOutOverTheTrainingYardOpening() {
    assertSpread(spread(true), "training yard");
  }

  @Test
  void teamsSpreadOutOverTheSyntheticOpening() {
    assertSpread(spread(false), "synthetic arena");
  }

  @Test
  void rushesAndSplitsTakeMoreThanOneLane() {
    for (var strategy : List.of(Strategy.RUSH, Strategy.SPLIT)) {
      var yard = play(Arenas.yard(4, 8, strategy, strategy), (int) Watch.OPENING_TICKS);
      var synthetic = play(Arenas.synthetic(4, 4, strategy, strategy), (int) Watch.OPENING_TICKS);
      for (var team : List.of(RED, BLUE)) {
        assertThat(yard.lanesUsed(team))
            .as("yard %s %s lanes", team, strategy)
            .isGreaterThanOrEqualTo(2);
        assertThat(yard.widest(team))
            .as("yard %s %s width", team, strategy)
            .isGreaterThanOrEqualTo(12);
        assertThat(synthetic.lanesUsed(team))
            .as("synthetic %s %s lanes", team, strategy)
            .isGreaterThanOrEqualTo(2);
      }
    }
  }

  /** The share of bots that must reach claimed cover: main's bootstrap lower bound, below. */
  private static final double COVER_FLOOR = 0.308;

  @Test
  void botsThatSeeTheEnemyGetIntoCoverTheyClaimed() {
    var saw = 0;
    var covered = 0;
    // 72 matches, splits and hunts against rushes: a bot sees an enemy within contact range once
    // out of its spawn, and has 3 s to stand in cover it claimed. The yard is open ground with a
    // few pillars, and planters, chasers and archers already fighting have better things to do.
    // Main (47b94f1fe9) gets 359 of 1114 (32.2%) into cover on exactly these matches. A bar one
    // match below that is under one standard error (about 15 bots), so a change that only moves
    // trajectories flips it. The floor is the one-sided 95% lower bound of main's rate instead:
    // 10,000 bootstrap resamples of main's 72 per-match tallies (whole matches, Python
    // random.Random(20261029)), each resample's covered over saw, gives 30.8%. The two-sided 95%
    // interval is 30.5% to 34.0%.
    for (var seed = 1L; seed <= 72; seed++) {
      var world =
          Arenas.yard(seed, 8, seed % 2 == 0 ? Strategy.SPLIT : Strategy.HUNT, Strategy.RUSH);
      var watch = play(world, 1200);
      var tally = watch.cover(world.tick);
      saw += tally.saw();
      covered += tally.covered();
    }
    assertThat(saw).isGreaterThanOrEqualTo(10);
    assertThat(covered)
        .as("%d of %d bots in claimed cover within 3 s", covered, saw)
        .isGreaterThanOrEqualTo((int) Math.ceil(saw * COVER_FLOOR));
  }

  /**
   * The trace hash of one playbook match on the training yard. It pins the whole think stack's
   * output: a deliberate change to how bots play moves it, and the new value is pasted here in the
   * same change; an accidental one fails here.
   */
  // Duration-weighted route density avoids needless run-ups; uncovered bounds finish before
  // replanning, with predictive teammate spacing and supported native wall sliding.
  // Composed with certified launch recovery, local squad bounds and committed fuse work.
  // Failed routes recover as RECOVER steps with a re-entry walk; landed bodies route as grounded.
  // Bots route around teammates ranked ahead only; idle and recovery plans earn no commitment.
  // Holders patrol between posts about their hold instead of standing still.
  // Archers hold a draw ready through brief sight loss and take skill-scaled long shots, clearing
  // teammates along the led arrow path and re-settling their aim when the target changes.
  // Holders watch visible enemies at any range and guards meet attackers on their way in, at most
  // two per attacker on opposite sides of its bearing.
  // Archers retaking or hunting take a target out to the middle of their band.
  // A hit places its attacker in the victim's memory and draws the victim's aggro (aggro=1).
  // Traces carry the distance to a hostile golem in sight (golemDist).
  // Standing enemies' name tags place them through walls within 32 blocks, privately; crouchers are
  // seen only half as far.
  // A push held in contact moves on after a stall or when the team leads the fight, and a team well
  // ahead closes the round out with a plant rush and hunting pairs.
  // Leaps are planned while their body runs up the line, judged where a plan reaches the body, and
  // a run-up the body is already on is joined rather than walked back to.
  // Bots keep sprinting while strafing in contact; sprint jumps boost along the steering heading.
  // Bots sprint-jump along straight runs, and route to a melee target their first step cannot take.
  // Archers shoot as they back off a sword; bots press in the band and face an enemy in contact.
  private static final String PINNED_YARD_HASH = "f98565cc58073ae8";

  @Test
  void aTrainingYardMatchReplaysToItsPinnedHash() {
    var first = Arenas.yard(7, 8, Strategy.RUSH, Strategy.SPLIT);
    first.run(600, w -> false);
    var second = Arenas.yard(7, 8, Strategy.RUSH, Strategy.SPLIT);
    second.run(600, w -> false);
    assertThat(second.hash).isEqualTo(first.hash);
    assertThat(first.hash.hex()).isEqualTo(PINNED_YARD_HASH);
  }

  @Test
  void snipersFightFromFurtherAwayThanDuelists() {
    var sniper = new ArrayList<Double>();
    var duelist = new ArrayList<Double>();
    for (var seed : SEEDS) {
      var watch = play(Arenas.yard(seed, 8, Strategy.RUSH, Strategy.HUNT), 1600);
      sniper.addAll(watch.ranges(Archetype.SNIPER));
      duelist.addAll(watch.ranges(Archetype.DUELIST));
    }
    assertThat(sniper).isNotEmpty();
    assertThat(duelist).isNotEmpty();
    assertThat(Watch.median(sniper))
        .as("sniper median %s vs duelist %s", Watch.median(sniper), Watch.median(duelist))
        .isGreaterThan(Watch.median(duelist));
  }
}
