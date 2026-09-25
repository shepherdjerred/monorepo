package com.shepherdjerred.thestorm.qol.app;

import com.shepherdjerred.thestorm.qol.domain.rtp.BlockPoint;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** Recent random-teleport landings, so the next player is not dropped on the last one. */
public final class LandingMemory {

  private final Duration memory;
  private final List<Landing> landings = new ArrayList<>();

  public LandingMemory(Duration memory) {
    this.memory = memory;
  }

  /** Remembers a landing. Main thread only. */
  public void remember(String world, int x, int z, Instant now) {
    forget(now);
    landings.add(new Landing(world, x, z, now));
  }

  /** Landings in {@code world} that are still inside the memory window. */
  public List<BlockPoint> points(String world, Instant now) {
    forget(now);
    var points = new ArrayList<BlockPoint>();
    for (var landing : landings) {
      if (landing.world().equals(world)) {
        points.add(new BlockPoint(landing.x(), landing.z()));
      }
    }
    return List.copyOf(points);
  }

  private void forget(Instant now) {
    landings.removeIf(landing -> !now.isBefore(landing.at().plus(memory)));
  }

  private record Landing(String world, int x, int z, Instant at) {}
}
