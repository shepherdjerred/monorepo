package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * On the shipped training yard (an open 64 by 64 box) teams move up the field like a side: spread
 * across the yard's width, most of the team past its own third, and walking where it is going
 * rather than circling at home. Every strategy plays every strategy once, each on its own seed.
 * First contact here comes at 5 to 8 s, when the lanes meet in the middle, so how far a team got is
 * taken at 10 s rather than at contact.
 */
final class AdvanceTest {

  private static final List<Strategy> ATTACKING =
      List.of(Strategy.RUSH, Strategy.SPLIT, Strategy.HUNT);

  /** The narrowest any team may be across the yard at 8 s and at first contact. */
  private static final double MIN_WIDTH = 15;

  /** The narrowest the median team may be across the yard. */
  private static final double MEDIAN_WIDTH = 24;

  /**
   * The least share of an attacking team's non-anchors past their own third by 10 s, on average.
   */
  private static final double MIN_FORWARD = 0.45;

  /** The most a team may walk for the ground it gains before contact. */
  private static final double MAX_WINDING = 2.5;

  private record Run(Strategy red, Strategy blue, Advance advance) {

    Strategy of(TeamId team) {
      return team.equals(RED) ? red : blue;
    }
  }

  private static List<Run> play() {
    var runs = new ArrayList<Run>();
    var seed = 10L;
    for (var red : Strategy.values()) {
      for (var blue : Strategy.values()) {
        var world = Arenas.yard(seed++, 8, red, blue);
        var advance = new Advance(world);
        world.run(900, advance::observe);
        runs.add(new Run(red, blue, advance));
      }
    }
    return runs;
  }

  private static final List<Run> RUNS = play();

  @Test
  void teamsSpreadAcrossTheYard() {
    var widths = new ArrayList<Double>();
    for (var run : RUNS) {
      for (var team : List.of(RED, BLUE)) {
        assertThat(run.advance().spreadAt8(team))
            .as("%s %s width at 8 s", run.of(team), team)
            .isGreaterThanOrEqualTo(MIN_WIDTH);
        assertThat(run.advance().spreadAtContact(team))
            .as("%s %s width at first contact", run.of(team), team)
            .isGreaterThanOrEqualTo(MIN_WIDTH);
        widths.add(run.advance().spreadAt8(team));
        widths.add(run.advance().spreadAtContact(team));
      }
    }
    assertThat(Watch.median(widths))
        .as("median width %s", widths)
        .isGreaterThanOrEqualTo(MEDIAN_WIDTH);
  }

  @Test
  void attackingTeamsGetPastTheirOwnThird() {
    var shares = new ArrayList<Double>();
    for (var run : RUNS) {
      if (ATTACKING.contains(run.red())) {
        shares.add(run.advance().forwardBy(RED));
      }
      if (ATTACKING.contains(run.blue())) {
        shares.add(run.advance().forwardBy(BLUE));
      }
    }
    assertThat(Watch.mean(shares))
        .as("mean share of non-anchors past their own third by 10 s: %s", shares)
        .isGreaterThanOrEqualTo(MIN_FORWARD);
  }

  @Test
  void teamsWalkWhereTheyAreGoingInsteadOfCircling() {
    for (var run : RUNS) {
      for (var team : List.of(RED, BLUE)) {
        assertThat(run.advance().winding(team))
            .as("%s %s path over displacement before contact", run.of(team), team)
            .isLessThanOrEqualTo(MAX_WINDING);
      }
    }
  }

  @Test
  void everyMatchReachesContact() {
    assertThat(RUNS).allMatch(run -> run.advance().contact().isPresent());
  }
}
