package com.shepherdjerred.thestorm.npcs.domain.brain;

import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcPose;
import java.util.List;

/** What an NPC is trying to do right now, with its places resolved. */
public sealed interface Intent {

  /** Stand at {@code spot}, facing its direction, holding {@code pose}. */
  record Stand(Spot spot, NpcPose pose) implements Intent {}

  /** Stroll to random points within {@code radius} blocks of {@code center}. */
  record Wander(Spot center, int radius) implements Intent {}

  /** Walk {@code route} in order and repeat. */
  record Patrol(List<Spot> route) implements Intent {

    public Patrol {
      route = List.copyOf(route);
      if (route.isEmpty()) {
        throw new IllegalArgumentException("a patrol needs a route");
      }
    }
  }

  /** Lie down at {@code bed}. */
  record Sleep(Spot bed) implements Intent {}
}
