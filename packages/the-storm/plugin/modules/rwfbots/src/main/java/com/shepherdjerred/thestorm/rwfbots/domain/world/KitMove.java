package com.shepherdjerred.thestorm.rwfbots.domain.world;

import java.util.regex.Pattern;

/**
 * One kit item a bot knows how to use, and the moment it uses it.
 *
 * @param item the item's material, as rwf's kit list names it
 * @param use when the bot uses it, and at what
 * @param min the near edge of the distance that matters to {@code use}, blocks
 * @param max the far edge, blocks
 * @param gapTicks the fewest ticks between two uses
 */
public record KitMove(String item, Use use, double min, double max, int gapTicks) {

  private static final Pattern MATERIAL = Pattern.compile("[A-Z][A-Z0-9_]*");

  /** When a bot uses a kit item. */
  public enum Use {
    /** An ally within {@code max} is hurt: wave the wand. */
    HEAL_ALLIES,
    /** No enemy known within {@code min} and the bot has reached its place: put it down there. */
    PLACE,
    /** An enemy is visible between {@code min} and {@code max}: use it looking at them. */
    AT_ENEMY,
    /** An enemy is within {@code max}: use it on them. */
    TOUCH_ENEMY,
    /** A teammate is within {@code max}: use it on the nearest. */
    TOUCH_ALLY,
    /**
     * No enemy known within {@code min} and a teammate stands between {@code min} and {@code max}
     * away: use it on the farthest, as the Teleporter's remote puts a teleporter under them.
     */
    FAR_ALLY,
    /** Its own health is under half: use it, as a Sacrificial snips its bonds. */
    SELF_LOW,
    /** Hurt below half with an enemy within {@code max}: use it looking at them. */
    DEFEND,
    /**
     * No enemy within {@code min} and the next waypoint is between {@code min} and {@code max}
     * away: use it looking at the waypoint.
     */
    TRAVEL,
    /**
     * Hurt with an enemy in sight, working a fuse under enemy eyes, or outnumbered within {@code
     * max}: put it down where it stands, as the Smokescreen's smoke.
     */
    COVER,
    /**
     * Standing still with two teammates within {@code max} and a fight coming, no enemy within
     * {@code min}: sound it, as the Tactician's horn.
     */
    RALLY,
    /**
     * Thrown onto certified ground of its own path between {@code min} and {@code max} away, to
     * close on a fleeing or ranged enemy or to escape one, as an ender pearl.
     */
    BLINK,
    /**
     * Burst against an enemy within {@code min} to push it away or off a ledge, at its own feet to
     * leap at one within {@code max} or away from one when hurt, as a wind charge.
     */
    GUST
  }

  public KitMove {
    if (!MATERIAL.matcher(item).matches()) {
      throw new IllegalArgumentException("item must look like BLAZE_ROD: " + item);
    }
    if (!(min >= 0) || !(max >= 0) || gapTicks < 1) {
      throw new IllegalArgumentException("distances must not be negative and the gap positive");
    }
  }
}
