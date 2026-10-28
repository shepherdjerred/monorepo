package com.shepherdjerred.thestorm.qol.domain.bank;

import java.util.List;

/**
 * How many banks and shelves a player may have, and how far a link or a find may reach.
 *
 * @param banksPerPlayer the most banks one player may own
 * @param shelvesPerBank the most shelves on one bank
 * @param linkRadius how far, in blocks, a shelf may sit from its bank
 * @param findRadius how far, in blocks, {@code /bank find} looks
 */
public record LimitSet(int banksPerPlayer, int shelvesPerBank, int linkRadius, int findRadius) {

  public LimitSet {
    if (banksPerPlayer < 1) {
      throw new IllegalArgumentException("banksPerPlayer must be positive: " + banksPerPlayer);
    }
    if (shelvesPerBank < 1) {
      throw new IllegalArgumentException("shelvesPerBank must be positive: " + shelvesPerBank);
    }
    if (linkRadius < 1) {
      throw new IllegalArgumentException("linkRadius must be positive: " + linkRadius);
    }
    if (findRadius < 1) {
      throw new IllegalArgumentException("findRadius must be positive: " + findRadius);
    }
  }

  /** The most generous limit on each field. A granted group never tightens the base. */
  public static LimitSet widest(LimitSet base, List<LimitSet> granted) {
    var banks = base.banksPerPlayer;
    var shelves = base.shelvesPerBank;
    var link = base.linkRadius;
    var find = base.findRadius;
    for (var extra : granted) {
      banks = Math.max(banks, extra.banksPerPlayer);
      shelves = Math.max(shelves, extra.shelvesPerBank);
      link = Math.max(link, extra.linkRadius);
      find = Math.max(find, extra.findRadius);
    }
    return new LimitSet(banks, shelves, link, find);
  }

  /** Whether {@code (dx, dy, dz)} is within {@code radius} blocks, measured in a straight line. */
  public static boolean inRange(long dx, long dy, long dz, int radius) {
    if (radius < 1) {
      throw new IllegalArgumentException("radius must be positive: " + radius);
    }
    var limit = (long) radius * radius;
    return dx * dx + dy * dy + dz * dz <= limit;
  }
}
