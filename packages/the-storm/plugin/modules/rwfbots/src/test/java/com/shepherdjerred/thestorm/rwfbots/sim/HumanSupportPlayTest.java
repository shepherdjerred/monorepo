package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.team.HumanSupport;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * A scripted human on a team of bots, on the training yard: while it arms the blue bomb the bots
 * near it come to cover it and click the fuse with it, and with nothing going on one bot keeps it
 * company instead of leaving it alone.
 */
final class HumanSupportPlayTest {

  /** When a bot must stand beside the arming human, in ticks. */
  private static final long COVERED_BY = 125;

  /** The scripted human's id. */
  private static final int HUMAN = 40;

  private static Vec3 ground(SimWorld world, Vec3 at) {
    var graph = world.nav.graph();
    return graph.feet(graph.nearestNodeWithin(at, 6).orElseThrow());
  }

  private static Vec3 fuse(SimWorld world) {
    return world.nav.sites().bomb("blue-1").orElseThrow().cell().center();
  }

  /**
   * Five red bots on the far side of the yard from the nuke, out of a fuse's helping range but
   * within {@link HumanSupport#NEARBY} of the blue bomb, a red human at {@code human}, and six blue
   * enemies standing in the far corners: an even fight, so the red planter holds its lane instead
   * of rushing the bomb.
   */
  private static SimWorld world(long seed, Vec3 human, Strategy strategy) {
    var world = new SimWorld(Arenas.YARD, seed);
    var id = 0;
    for (var bomb : Arenas.YARD.sites().bombs()) {
      if (bomb.team().isPresent()) {
        world.addBomb(
            id++,
            new com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId(bomb.team().orElseThrow()),
            bomb.cell());
      } else {
        world.addNuke(id++, bomb.cell());
      }
    }
    var fuse = fuse(world);
    for (var i = 0; i < 5; i++) {
      world.addBot(
          new SimWorld.Spawn(
              i + 1,
              RED,
              Kit.TROOPER,
              ground(world, fuse.plus(-12 + 2 * (i % 2), 0, i < 3 ? -24 : 24))),
          0.7);
    }
    world.addScripted(new SimWorld.Spawn(HUMAN, RED, Kit.TROOPER, human));
    for (var i = 0; i < 6; i++) {
      var corner = new Vec3(3 + 2 * (i % 3), 65, i < 3 ? 3 : 60);
      world.addScripted(new SimWorld.Spawn(90 + i, BLUE, Kit.TROOPER, ground(world, corner)));
    }
    world.setStrategy(RED, strategy);
    return world;
  }

  private static double nearestBot(SimWorld world, Vec3 to) {
    return world.bodies.values().stream()
        .filter(body -> body.bot && body.alive)
        .mapToDouble(body -> body.pos.distance(to))
        .min()
        .orElse(Double.POSITIVE_INFINITY);
  }

  @Test
  void botsComeToCoverAndClickWithAHumanArmingABomb() {
    var covered = new ArrayList<Long>();
    var helped = new ArrayList<Integer>();
    for (var seed = 70L; seed < 74; seed++) {
      var probe = new SimWorld(Arenas.YARD, seed);
      var at = ground(probe, fuse(probe).plus(-2, 0, 0));
      // Turtling: the team holds its own side, so only support brings a bot to the arming human.
      var world = world(seed, at, Strategy.TURTLE);
      var bomb = world.bomb(1);
      var human = new CombatantId(HUMAN);
      var firstCover = new long[] {-1};
      var hands = new int[1];
      world.run(
          400,
          w -> {
            if (bomb.phase == SimBomb.Phase.IDLE || bomb.phase == SimBomb.Phase.ARMING)
              bomb.click(human, RED, w.tick, false);
            hands[0] = Math.max(hands[0], bomb.clickers.size());
            if (firstCover[0] < 0 && nearestBot(w, at) <= HumanSupport.COVER_SIDE + 3)
              firstCover[0] = w.tick;
            return bomb.phase == SimBomb.Phase.ARMED;
          });
      covered.add(firstCover[0]);
      helped.add(hands[0]);
    }
    // Without support the first bot arrived at 133 to 153 ticks, after the plant was half done,
    // and only one seed of four got a second hand on the fuse.
    assertThat(covered)
        .as("a bot reached the arming human within six seconds")
        .allMatch(tick -> tick >= 0 && tick <= COVERED_BY);
    assertThat(helped).as("bots clicked the fuse with the human").allMatch(hands -> hands >= 2);
  }

  /**
   * The median, over the seeds below, of each match's median distance from the lone human to its
   * nearest bot may be at most this, in blocks: the one-sided 95% upper bound of main's (4.74),
   * rounded up.
   */
  private static final double COMPANY_MEDIAN_CEILING = 4.775;

  /** At least this many of the 32 matches keep a bot within 8 blocks: main's lower bound (30). */
  private static final int COMPANY_WITHIN_FLOOR = 28;

  /**
   * A human alone on the field keeps a bot's company, over 32 matches. Four seeds with an 8-block
   * bar on each flipped on noise: main itself has 2 of these 32 matches over 8 blocks. Both bounds
   * come from main (47b94f1fe9) alone: 10,000 bootstrap resamples of its 32 per-match medians
   * (Python random.Random(20261029)), the 95th percentile of the resampled median and the 5th
   * percentile of the resampled count within 8 blocks.
   */
  @Test
  void aHumanAloneOnTheFieldKeepsOneBotsCompany() {
    var near = new ArrayList<Double>();
    for (var seed = 80L; seed < 112; seed++) {
      var probe = new SimWorld(Arenas.YARD, seed);
      var at = ground(probe, new Vec3(31, 65, 8));
      var world = world(seed, at, Strategy.RUSH);
      var samples = new ArrayList<Double>();
      world.run(
          600,
          w -> {
            if (w.tick >= 300 && w.tick % 20 == 0) samples.add(nearestBot(w, at));
            return false;
          });
      near.add(median(samples));
    }
    assertThat(median(near))
        .as("median over matches of the median distance to the nearest bot: %s", near)
        .isLessThanOrEqualTo(COMPANY_MEDIAN_CEILING);
    assertThat(near.stream().filter(distance -> distance <= 8).count())
        .as("matches with a bot within 8 blocks after fifteen seconds: %s", near)
        .isGreaterThanOrEqualTo(COMPANY_WITHIN_FLOOR);
  }

  private static double median(List<Double> values) {
    var sorted = values.stream().sorted().toList();
    return sorted.get(sorted.size() / 2);
  }
}
