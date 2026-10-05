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

  @Test
  void botsThatSeeTheEnemyGetIntoCoverTheyClaimed() {
    var saw = 0;
    var covered = 0;
    // Twelve matches, splits and hunts against rushes: a bot sees an enemy within 28 blocks
    // once out of its spawn, and has 3 s to stand in cover it claimed.
    for (var seed = 1L; seed <= 12; seed++) {
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
        .isGreaterThanOrEqualTo((saw + 1) / 2);
  }

  /**
   * The trace hash of one playbook match on the training yard. It pins the whole think stack's
   * output: a deliberate change to how bots play moves it, and the new value is pasted here in the
   * same change; an accidental one fails here.
   */
  private static final String PINNED_YARD_HASH = "06a8343a673e579f";

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
