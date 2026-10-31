package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.ArrayList;
import java.util.List;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * A bow kit against a swordsman on open ground under rwf's 1.8 combat, both with their whole brain.
 * In production bow-kit bots got most of their kills in melee (the longbow 10 of 12): an archer
 * that keeps its distance and draws while it backs off kills with its bow.
 */
@Tag("simulation")
final class BowKitDuelTest {

  /** A flat 64-block stone field with a few pillars. */
  private static final class Field implements BlockClassification {
    private final GridBounds bounds = new GridBounds(new BlockPos(0, 0, 0), 64, 6, 64);

    @Override
    public GridBounds bounds() {
      return bounds;
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      return y == 0 ? BlockShape.FULL : BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return y == 0;
    }
  }

  private static final NavArtifact FIELD =
      MapBaker.bake("field", new Field(), new NavSites(List.of(), List.of()));

  private static final int LIMIT = 1200;
  private static final int SEEDS = 40;
  private static final double SKILL = 0.65;

  /**
   * One duel's end.
   *
   * @param archerWon whether the archer killed the swordsman
   * @param swordWon whether the swordsman killed the archer
   * @param distance how far the killer stood at the last blow, or -1
   * @param byArrow whether the last blow was an arrow
   */
  record End(boolean archerWon, boolean swordWon, double distance, boolean byArrow) {}

  /**
   * Before, a longbow backed away from the sword without drawing and never loosed an arrow: of 40
   * duels it won none and lost 8, the rest timing out. A shortbow won none and lost 34. Now the
   * longbow wins 26 and loses 1, the shortbow wins 19 and loses 6, every win by arrow, at a median
   * 11.5 and 8.1 blocks.
   */
  @Test
  void aBowKitKeepsASwordAtADistanceAndKillsItWithItsBow() {
    for (var kit : List.of(Kit.LONGBOW, Kit.SHORTBOW)) {
      var ends = new ArrayList<End>();
      for (var seed = 1L; seed <= SEEDS; seed++) ends.add(duel(kit, seed));
      var won = ends.stream().filter(End::archerWon).toList();
      var lost = ends.stream().filter(End::swordWon).count();
      var description = kit + " " + summary(ends);
      assertThat(won).as(description).hasSizeGreaterThanOrEqualTo(12);
      // The swordsman is a bot too: what is asserted is the archer's play, its kills by bow at a
      // distance, more than any margin over an opponent that improves on its own.
      assertThat((long) won.size()).as(description).isGreaterThan(lost);
      assertThat(won.stream().filter(End::byArrow).count())
          .as(description)
          .isGreaterThanOrEqualTo(won.size() * 9L / 10);
      assertThat(won.stream().mapToDouble(End::distance).sorted().toArray()[won.size() / 2])
          .as(description)
          .isGreaterThan(6);
    }
  }

  static String summary(List<End> ends) {
    var won = ends.stream().filter(End::archerWon).toList();
    var lost = ends.stream().filter(End::swordWon).count();
    var arrows = won.stream().filter(End::byArrow).count();
    var distances = won.stream().mapToDouble(End::distance).sorted().toArray();
    var median = distances.length == 0 ? -1 : distances[distances.length / 2];
    return String.format(
        "archer won %d, lost %d, undecided %d; won by arrow %d; median kill distance %.1f",
        won.size(), lost, ends.size() - won.size() - lost, arrows, median);
  }

  static End duel(Kit kit, long seed) {
    var world = Brawl.world(FIELD, seed);
    var random = new SplittableRandom(seed * 17);
    var archerAt = new Vec3(20.5 + random.nextInt(8), 1, 12.5 + random.nextInt(8));
    var angle = random.nextDouble() * Math.PI / 3 + Math.PI / 6;
    var distance = 22 + random.nextDouble() * 6;
    var swordAt =
        archerAt.plus(new Vec3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance));
    var archer = world.addBot(new SimWorld.Spawn(1, RED, kit, archerAt), SKILL);
    var sword = world.addBot(new SimWorld.Spawn(2, BLUE, Kit.TROOPER, swordAt), SKILL);
    Brawl.face(archer, sword);
    Brawl.face(sword, archer);
    Brawl.fight(world, LIMIT, () -> {});
    var archerWon = sword.death.isPresent() && archer.death.isEmpty();
    var swordWon = archer.death.isPresent() && sword.death.isEmpty();
    var last = archerWon ? sword.death : archer.death;
    return new End(
        archerWon,
        swordWon,
        last.map(SimBody.Death::distance).orElse(-1.0),
        last.filter(death -> death.cause() == SimBody.Cause.ARROW).isPresent());
  }
}
