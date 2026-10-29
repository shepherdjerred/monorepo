package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Objective ownership, safe-resume hysteresis, bounded memory of inaccessible destinations, and
 * since when the bot has been tied up fighting ({@code engagedSince}, -1 while it is not), which
 * teammates read to take a fuse off a responder stuck in a fight.
 */
public record TacticalMemory(
    Optional<BombId> defusing,
    Optional<BombId> detour,
    long safeSince,
    Map<Vec3, Long> blockedUntil,
    long engagedSince) {
  public static final TacticalMemory EMPTY =
      new TacticalMemory(Optional.empty(), Optional.empty(), -1, Map.of(), -1);
  public static final long BLOCK_TICKS = 100;
  public static final long RESUME_TICKS = 15;

  public TacticalMemory {
    blockedUntil = Map.copyOf(blockedUntil);
  }

  public TacticalMemory blocked(Vec3 goal, long tick) {
    var copy = new HashMap<Vec3, Long>();
    blockedUntil.forEach(
        (point, until) -> {
          if (until > tick) copy.put(point, until);
        });
    copy.put(goal, tick + BLOCK_TICKS);
    if (copy.size() > 16) {
      var oldest =
          copy.entrySet().stream()
              .min(
                  java.util.Comparator.comparing((Map.Entry<Vec3, Long> entry) -> entry.getValue())
                      .thenComparingDouble(entry -> entry.getKey().x())
                      .thenComparingDouble(entry -> entry.getKey().z()))
              .orElseThrow();
      copy.remove(oldest.getKey());
    }
    return new TacticalMemory(defusing, detour, safeSince, copy, engagedSince);
  }

  public boolean excludes(Vec3 goal, long tick) {
    return blockedUntil.entrySet().stream()
        .anyMatch(entry -> entry.getValue() > tick && entry.getKey().distance(goal) < 1.5);
  }

  public TacticalMemory objective(Optional<BombId> task, Optional<BombId> diversion, long safe) {
    return new TacticalMemory(task, diversion, safe, blockedUntil, engagedSince);
  }

  /** Memory after a think at {@code now} that did or did not leave the bot fighting. */
  public TacticalMemory engaged(boolean fighting, long now) {
    var since = fighting ? (engagedSince >= 0 ? engagedSince : now) : -1;
    return since == engagedSince
        ? this
        : new TacticalMemory(defusing, detour, safeSince, blockedUntil, since);
  }
}
