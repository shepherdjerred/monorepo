package com.shepherdjerred.thestorm.towns.domain.protection;

import java.util.UUID;

/**
 * The player acting.
 *
 * @param player their id
 * @param bypass true for staff with the bypass permission; they may build anywhere, but bypass
 *     never allows fighting where PvP is off
 */
public record Actor(UUID player, boolean bypass) {

  public static Actor player(UUID player) {
    return new Actor(player, false);
  }
}
