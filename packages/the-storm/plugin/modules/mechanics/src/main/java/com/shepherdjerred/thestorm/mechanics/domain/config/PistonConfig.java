package com.shepherdjerred.thestorm.mechanics.domain.config;

import java.util.List;
import java.util.Set;

/**
 * Special pistons: {@code [Crush]}, {@code [Bounce]}, {@code [SuperSticky]} and {@code [SuperPush]}
 * signs next to a piston.
 *
 * @param crush who may build crushing pistons
 * @param bounce who may build bouncing pistons
 * @param superSticky who may build super-sticky pistons
 * @param superPush who may build super-push pistons
 * @param bounceForce the speed, in blocks per tick, a bouncing piston launches entities at
 * @param stickyReach how far in front of a super-sticky piston blocks are pulled from
 * @param pushDistance how many extra blocks a super-push piston moves its load
 * @param maxBlocks the most blocks a super piston moves at once
 * @param blacklist blocks special pistons never crush or move; block entities (containers,
 *     spawners, vaults) and unbreakable blocks are always refused as well
 */
public record PistonConfig(
    Unlock crush,
    Unlock bounce,
    Unlock superSticky,
    Unlock superPush,
    double bounceForce,
    int stickyReach,
    int pushDistance,
    int maxBlocks,
    List<String> blacklist) {

  public static final double MAX_BOUNCE_FORCE = 4.0;
  public static final int MAX_REACH = 16;
  public static final int MAX_BLOCKS = 16;

  public PistonConfig {
    Checks.range("bounceForce", bounceForce, 0.1, MAX_BOUNCE_FORCE);
    Checks.range("stickyReach", stickyReach, 2, MAX_REACH);
    Checks.range("pushDistance", pushDistance, 1, MAX_REACH);
    Checks.range("maxBlocks", maxBlocks, 1, MAX_BLOCKS);
    blacklist = List.copyOf(Checks.materials("blacklist", blacklist));
  }

  public Set<String> refused() {
    return Set.copyOf(blacklist);
  }
}
