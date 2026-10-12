// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/killstreak/streaks/
// IronGolemKillstreak.java and PathfinderSelector.java), with the Minecraft 1.12 goals that
// IronGolemKillstreak gave the golem; see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.killstreak;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.random.RandomGenerator;

/**
 * How the killstreak iron golem thinks. Red Warfare cleared the golem's own goals and gave it the
 * Minecraft 1.12 goals below, its targets chosen through its {@code PathfinderSelector}:
 *
 * <ul>
 *   <li>float (priority 0): swim up in water or lava;
 *   <li>melee attack (2): chase the target without remembering it once the path runs out, and hit
 *       it when in reach; a blow that lands holds the next one off for {@link #LANDED_COOLDOWN}
 *       ticks rather than {@link #ATTACK_COOLDOWN};
 *   <li>random stroll (7), look at a player within 8 blocks (8), look around (8);
 *   <li>targets (2): the nearest player it can see, then the nearest mob, either one the selector
 *       allows: alive, not a teammate player, and not a Ghost or Wraith giving nothing away.
 * </ul>
 *
 * <p>Its other goals came to nothing: it was never hurt through the server's own damage, so it
 * never sought revenge, and a summoned golem has no village to keep to. The rules here are pure;
 * the adapter feeds them what the golem sees.
 */
public final class GolemAi {

  /** How far the golem looks for and follows a target: a mob's default follow range. */
  public static final double FOLLOW_RANGE = 16;

  /** A mob target is looked for in the golem's box grown this much up and down. */
  public static final double SEARCH_HEIGHT = 4;

  /** A sneaking player is found within this share of the range. */
  public static final double SNEAK_RANGE = 0.8;

  /** An invisible player is found within this share of the range, times their armour cover. */
  public static final double INVISIBLE_RANGE = 0.7;

  /** An invisible player's armour cover never counts for less than this. */
  public static final double LEAST_COVER = 0.1;

  /** A player target the golem cannot see for more than this many ticks is dropped. */
  public static final int UNSEEN_TICKS = 60;

  /** Ticks between two swings, and after a swing whose blow landed. */
  public static final int ATTACK_COOLDOWN = 20;

  public static final int LANDED_COOLDOWN = 30;

  /** The golem walks at its own speed, unscaled, in every goal. */
  public static final double SPEED = 1;

  /** How far the golem turns its head a tick while it fights, in degrees. */
  public static final float CHASE_TURN = 30;

  /** A chance per tick to swim up, to stroll (one in this), to glance at someone or around. */
  public static final float FLOAT_CHANCE = 0.8F;

  public static final int STROLL_ONE_IN = 120;

  public static final float LOOK_CHANCE = 0.02F;

  /** A golem idle this long, in ticks, with no player near, no longer strolls. */
  public static final int STROLL_IDLE = 100;

  /** A stroll tries this many spots this far across and this far up or down. */
  public static final int STROLL_TRIES = 10;

  public static final int STROLL_REACH = 10;

  public static final int STROLL_HEIGHT = 7;

  /** It looks at players within this many blocks. */
  public static final double LOOK_RANGE = 8;

  private GolemAi() {}

  /** Which of the two target goals found the target. */
  public enum Seeking {
    /** The nearest player, which the golem must keep seeing. */
    PLAYER,
    /** The nearest mob, seen or not. */
    MOB
  }

  /**
   * What the golem can tell of one creature near it.
   *
   * @param who the creature, as the adapter knows it
   * @param pos its feet
   * @param player whether it is a player
   * @param alive whether Red Warfare counted it alive: a player fighting in the match, or any other
   *     creature still in the world
   * @param ally whether it fights for the golem's team
   * @param hidden whether it is a Ghost or Wraith giving nothing away (see {@link #hidden})
   * @param creeper whether it is a creeper, which no iron golem attacks
   * @param untouchable whether it is a player in creative or spectator mode
   * @param sneaking whether it sneaks
   * @param invisible whether it is invisible
   * @param armorCover the share of its armour slots filled, 0 to 1
   * @param seen whether the golem can see it
   * @param <T> how the adapter knows a creature
   */
  public record Sighting<T>(
      T who,
      Vec3 pos,
      boolean player,
      boolean alive,
      boolean ally,
      boolean hidden,
      boolean creeper,
      boolean untouchable,
      boolean sneaking,
      boolean invisible,
      double armorCover,
      boolean seen) {}

  /**
   * Whether a Ghost or Wraith gives nothing away: not sprinting, nothing in either hand, and no
   * arrow sticking out. Such a player is never a summon's prey.
   */
  public static boolean hidden(boolean hidingKit, boolean sprinting, boolean holding, int arrows) {
    return hidingKit && !sprinting && !holding && arrows <= 0;
  }

  /**
   * Red Warfare's {@code PathfinderSelector}: alive, and if a player, neither a teammate nor a
   * hidden Ghost or Wraith. It kept no tally of the team's summons, so another summon of the
   * golem's own team passes it; the match refuses that target when the golem takes it.
   */
  public static boolean selects(Sighting<?> sighting) {
    if (!sighting.alive()) {
      return false;
    }
    return !sighting.player() || (!sighting.hidden() && !sighting.ally());
  }

  /**
   * Minecraft 1.12's suitable target: alive, no creeper, no player in creative or spectator mode,
   * and in sight when {@code needsSight}.
   */
  public static boolean suitable(Sighting<?> sighting, boolean needsSight) {
    return sighting.alive()
        && !sighting.creeper()
        && !(sighting.player() && sighting.untouchable())
        && (!needsSight || sighting.seen());
  }

  /**
   * The player target: the nearest the selector allows, in sight, within {@link #FOLLOW_RANGE}
   * across (less for a sneaking or invisible player), measured across the ground from the golem's
   * eyes. Minecraft 1.12 compared the height difference with the range squared, so anyone within
   * 256 blocks up or down counts. The first of equally near players wins.
   *
   * @param feet the golem's feet
   * @param eyeHeight the golem's eye height
   * @param players every player in the world, in the world's order
   */
  public static <T> Optional<Sighting<T>> nearestPlayer(
      Vec3 feet, double eyeHeight, List<Sighting<T>> players) {
    var eyeY = feet.y() + eyeHeight;
    Optional<Sighting<T>> best = Optional.empty();
    var bestDistance = -1.0;
    for (var sighting : players) {
      if (!selects(sighting) || !suitable(sighting, true)) {
        continue;
      }
      var dx = sighting.pos().x() - feet.x();
      var dz = sighting.pos().z() - feet.z();
      var across = dx * dx + dz * dz;
      var range = FOLLOW_RANGE;
      if (sighting.sneaking()) {
        range *= SNEAK_RANGE;
      }
      if (sighting.invisible()) {
        range *= INVISIBLE_RANGE * Math.max(LEAST_COVER, sighting.armorCover());
      }
      if (Math.abs(sighting.pos().y() - eyeY) < FOLLOW_RANGE * FOLLOW_RANGE
          && across < range * range
          && (bestDistance < 0 || across < bestDistance)) {
        best = Optional.of(sighting);
        bestDistance = across;
      }
    }
    return best;
  }

  /**
   * The mob target: of the mobs in the golem's box grown by {@link #FOLLOW_RANGE} across and {@link
   * #SEARCH_HEIGHT} up and down, the nearest (feet to feet) the selector allows, seen or not.
   */
  public static <T> Optional<Sighting<T>> nearestMob(Vec3 feet, List<Sighting<T>> mobs) {
    var allowed = new ArrayList<Sighting<T>>();
    for (var sighting : mobs) {
      if (selects(sighting) && suitable(sighting, false)) {
        allowed.add(sighting);
      }
    }
    allowed.sort(Comparator.comparingDouble(sighting -> squared(feet, sighting.pos())));
    return allowed.isEmpty() ? Optional.empty() : Optional.of(allowed.getFirst());
  }

  /**
   * Whether a target goal keeps its target: still alive, no player in creative or spectator mode,
   * and no further than {@link #FOLLOW_RANGE}. A player target must also stay in sight, which
   * {@link #unseen} counts.
   */
  public static boolean keeps(Sighting<?> target, Vec3 feet) {
    return target.alive()
        && !(target.player() && target.untouchable())
        && squared(feet, target.pos()) <= FOLLOW_RANGE * FOLLOW_RANGE;
  }

  /**
   * The ticks a target has been out of sight after this tick, given {@code before}; the target is
   * dropped once this passes {@link #UNSEEN_TICKS}.
   */
  public static int unseen(int before, boolean seen) {
    return seen ? 0 : before + 1;
  }

  /**
   * How close, squared, the golem must be to hit a target: its width doubled, squared, plus the
   * target's width.
   */
  public static double reach(double golemWidth, double targetWidth) {
    var arm = golemWidth * 2;
    return arm * arm + targetWidth;
  }

  /**
   * The melee goal's memory between ticks.
   *
   * @param delay ticks until the path to the target may be recalculated
   * @param pathedTo where the target stood when the path was last recalculated
   * @param cooldown ticks until the golem may swing again
   */
  public record Chase(int delay, Optional<Vec3> pathedTo, int cooldown) {

    /** A chase just begun. */
    public static final Chase START = new Chase(0, Optional.empty(), 0);

    /** The swing landed: the next waits {@link #LANDED_COOLDOWN} ticks. */
    public Chase landed() {
      return new Chase(delay, pathedTo, LANDED_COOLDOWN);
    }

    /** The path just asked for could not be found: wait longer before asking again. */
    public Chase unreachable() {
      return new Chase(delay + 15, pathedTo, cooldown);
    }
  }

  /**
   * One tick of a chase.
   *
   * @param next the memory afterwards
   * @param repath whether to recalculate the path to the target now
   * @param swing whether to swing at the target now
   */
  public record Step(Chase next, boolean repath, boolean swing) {}

  /**
   * One tick of Minecraft 1.12's melee goal. The path is recalculated, at most every 4 to 10 ticks
   * (more when far off), while the target is in sight and has moved a block or, one time in twenty,
   * when it has not. The golem swings when the target is in {@code reach} and it has cooled down.
   *
   * @param chase the memory before this tick
   * @param target where the target is
   * @param seen whether the golem sees the target
   * @param random the golem's randomness
   */
  public static Step chase(Chase chase, Target target, boolean seen, RandomGenerator random) {
    var delay = chase.delay() - 1;
    var pathedTo = chase.pathedTo();
    var repath = false;
    if (seen
        && delay <= 0
        && (pathedTo.isEmpty()
            || squared(target.feet(), pathedTo.orElseThrow()) >= 1
            || random.nextFloat() < 0.05F)) {
      pathedTo = Optional.of(target.feet());
      delay = 4 + random.nextInt(7);
      if (target.distance() > 1024) {
        delay += 10;
      } else if (target.distance() > 256) {
        delay += 5;
      }
      repath = true;
    }
    var cooldown = Math.max(chase.cooldown() - 1, 0);
    var swing = target.distance() <= target.reach() && cooldown <= 0;
    if (swing) {
      cooldown = ATTACK_COOLDOWN;
    }
    return new Step(new Chase(delay, pathedTo, cooldown), repath, swing);
  }

  /**
   * Where the chased target is.
   *
   * @param feet its feet
   * @param distance the squared distance from the golem's feet
   * @param reach the squared reach, see {@link #reach}
   */
  public record Target(Vec3 feet, double distance, double reach) {}

  /** Whether the golem, idle for {@code idleTicks}, sets off on a stroll this tick. */
  public static boolean strolls(int idleTicks, RandomGenerator random) {
    return idleTicks < STROLL_IDLE && random.nextInt(STROLL_ONE_IN) == 0;
  }

  /**
   * The spots a stroll tries, as offsets from the golem's block, in order: the first one the golem
   * can walk to is taken. Each is up to {@link #STROLL_REACH} across and {@link #STROLL_HEIGHT} up
   * or down.
   */
  public static List<int[]> strollSpots(RandomGenerator random) {
    var spots = new ArrayList<int[]>();
    for (var i = 0; i < STROLL_TRIES; i++) {
      var x = random.nextInt(2 * STROLL_REACH + 1) - STROLL_REACH;
      var y = random.nextInt(2 * STROLL_HEIGHT + 1) - STROLL_HEIGHT;
      var z = random.nextInt(2 * STROLL_REACH + 1) - STROLL_REACH;
      spots.add(new int[] {x, y, z});
    }
    return List.copyOf(spots);
  }

  /** Whether the golem glances at a player, or around, this tick. */
  public static boolean glances(RandomGenerator random) {
    return random.nextFloat() < LOOK_CHANCE;
  }

  /** How many ticks a look at a player lasts: 40 to 79. */
  public static int lookTicks(RandomGenerator random) {
    return 40 + random.nextInt(40);
  }

  /** How many ticks a look around lasts: 20 to 39, the last tick included. */
  public static int glanceTicks(RandomGenerator random) {
    return 20 + random.nextInt(20);
  }

  /** Whether the golem in water or lava swims up this tick. */
  public static boolean swims(RandomGenerator random) {
    return random.nextFloat() < FLOAT_CHANCE;
  }

  private static double squared(Vec3 a, Vec3 b) {
    var dx = a.x() - b.x();
    var dy = a.y() - b.y();
    var dz = a.z() - b.z();
    return dx * dx + dy * dy + dz * dz;
  }
}
