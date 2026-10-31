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
import java.util.List;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Sword fights on narrow bridges over a fatal drop under rwf's 1.8 knockback, where 26 production
 * bot deaths came off an edge, 5 of them on hemispheres' diagonal bridge. A bot keeps ground behind
 * itself and, when it can, puts its enemy's back to the drop.
 */
@Tag("simulation")
final class EdgeFightTest {

  /** A seven-wide bridge over the void between two landings, straight or corner to corner. */
  private record Bridge(boolean diagonal) implements BlockClassification {
    static final int SIZE = 56;

    @Override
    public GridBounds bounds() {
      return new GridBounds(new BlockPos(0, 0, 0), SIZE, 6, SIZE);
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      return y == 0 && deck(x, z) ? BlockShape.FULL : BlockShape.PASSABLE;
    }

    private boolean deck(int x, int z) {
      if (diagonal) {
        return Math.abs(x - z) <= 4 || (x < 6 && z < 6) || (x >= SIZE - 6 && z >= SIZE - 6);
      }
      return (z >= 25 && z <= 31) || x < 4 || x >= SIZE - 4;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return y == 0 && deck(x, z);
    }
  }

  /**
   * Where a fight takes place.
   *
   * @param name what to call it
   * @param nav the map
   * @param centre the middle of the deck
   * @param along a unit step along the deck
   */
  private record Deck(String name, NavArtifact nav, Vec3 centre, Vec3 along) {}

  private static final Deck STRAIGHT =
      new Deck(
          "straight",
          MapBaker.bake("bridge", new Bridge(false), new NavSites(List.of(), List.of())),
          new Vec3(28.5, 1, 28.5),
          new Vec3(1, 0, 0));
  private static final Deck DIAGONAL =
      new Deck(
          "diagonal",
          MapBaker.bake("diagonal-bridge", new Bridge(true), new NavSites(List.of(), List.of())),
          new Vec3(28.5, 1, 28.5),
          new Vec3(1, 0, 1).normalized());

  /**
   * Hemispheres' diagonal bridge: five blocks of deck between one-block rails, 40 blocks over the
   * ground, from about (2133, 41, 3130) to (2148, 41, 3115).
   */
  private static final Deck HEMISPHERES =
      new Deck(
          "hemispheres",
          Arenas.shippedNav("hemispheres"),
          new Vec3(2140.5, 41, 3122.5),
          new Vec3(-1, 0, 1).normalized());

  private static final List<Deck> DECKS = List.of(STRAIGHT, DIAGONAL, HEMISPHERES);

  private static final int LIMIT = 900;
  private static final int SEEDS = 120;
  private static final double SKILL = 0.65;

  /** Fights that ended, by how each side died. */
  private static final class Tally {
    int fights;
    int botDeaths;
    int botOffEdge;
    int foeDeaths;
    int foeOffEdge;

    void add(SimBody bot, SimBody foe) {
      fights++;
      bot.death.ifPresent(
          death -> {
            botDeaths++;
            if (death.offEdge()) botOffEdge++;
          });
      foe.death.ifPresent(
          death -> {
            foeDeaths++;
            if (death.offEdge()) foeOffEdge++;
          });
    }

    @Override
    public String toString() {
      return String.format(
          "%d fights: bot died %d (%d off the edge), foe died %d (%d off the edge)",
          fights, botDeaths, botOffEdge, foeDeaths, foeOffEdge);
    }
  }

  /**
   * A bot rushed on the middle of a bridge by a player who sprint-hits on every window. Before the
   * bot read the ground behind it, 88 of 120 bots went off the straight bridge, 91 off the diagonal
   * and 41 off hemispheres'; with it 10, 10 and 31.
   */
  @Test
  void aBotRushedOnABridgeRarelyGoesOffTheEdge() {
    var limits = List.of(25, 25, 36);
    for (var i = 0; i < DECKS.size(); i++) {
      var deck = DECKS.get(i);
      var tally = new Tally();
      for (var seed = 1L; seed <= SEEDS; seed++) {
        rushed(deck, seed, tally);
      }
      assertThat(tally.fights).isEqualTo(SEEDS);
      assertThat(tally.botOffEdge)
          .as("rushed on %s: %s", deck.name(), tally)
          .isLessThanOrEqualTo(limits.get(i));
    }
  }

  /**
   * Two bots meeting on a bridge. Before, every one of the 128 deaths on the straight bridge and
   * the 135 on the diagonal one came off the edge; with it 15 of 120 and 25 of 120. On hemispheres'
   * railed bridge 21 of 29 deaths came off the edge before and 44 of 77 now: more fights end
   * because bots no longer stand stranded on the rail, and how they end swings widely with the
   * seeds, so it is not bounded here.
   */
  @Test
  void botsDuellingOnABridgeRarelyGoOffTheEdge() {
    var limits = List.of(40, 45);
    for (var i = 0; i < limits.size(); i++) {
      var deck = DECKS.get(i);
      var tally = new Tally();
      for (var seed = 1L; seed <= SEEDS; seed++) {
        duel(deck, seed, tally);
      }
      assertThat(tally.fights).isEqualTo(SEEDS);
      assertThat(tally.botOffEdge + tally.foeOffEdge)
          .as("duel on %s: %s", deck.name(), tally)
          .isLessThanOrEqualTo(limits.get(i));
    }
  }

  /** Where the foe starts: 6 to 9 blocks along the deck either way, up to two blocks across it. */
  private static Vec3 opposite(Deck deck, Vec3 from, SplittableRandom random) {
    var along = deck.along();
    var across = new Vec3(-along.z(), 0, along.x());
    var sign = random.nextBoolean() ? 1 : -1;
    return from.plus(along.scale(sign * (6 + 3 * random.nextDouble())))
        .plus(across.scale(3 * random.nextDouble() - 1.5));
  }

  /** A bot on the middle of the deck and a rusher coming at it. */
  private static void rushed(Deck deck, long seed, Tally tally) {
    var world = Brawl.world(deck.nav(), seed);
    world.engageOnly = true;
    var random = new SplittableRandom(seed * 31);
    var bot = world.addBot(new SimWorld.Spawn(1, RED, Kit.TROOPER, deck.centre()), SKILL);
    var rusher =
        world.addScripted(
            new SimWorld.Spawn(2, BLUE, Kit.TROOPER, opposite(deck, deck.centre(), random)));
    Brawl.face(bot, rusher);
    Brawl.fight(world, LIMIT, () -> Brawl.rush(world, rusher, bot));
    tally.add(bot, rusher);
  }

  /** Two bots meeting on the deck. */
  private static void duel(Deck deck, long seed, Tally tally) {
    var world = Brawl.world(deck.nav(), seed);
    world.engageOnly = true;
    var random = new SplittableRandom(seed * 31);
    var start = deck.centre().plus(deck.along().scale(random.nextBoolean() ? -3 : 3));
    var red = world.addBot(new SimWorld.Spawn(1, RED, Kit.TROOPER, start), SKILL);
    var blue =
        world.addBot(
            new SimWorld.Spawn(
                2, BLUE, Kit.TROOPER, start.plus(deck.centre().minus(start).scale(2))),
            SKILL);
    Brawl.face(red, blue);
    Brawl.face(blue, red);
    Brawl.fight(world, LIMIT, () -> {});
    tally.add(red, blue);
  }
}
