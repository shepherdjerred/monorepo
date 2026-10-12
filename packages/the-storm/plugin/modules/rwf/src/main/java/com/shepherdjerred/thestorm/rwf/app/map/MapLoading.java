package com.shepherdjerred.thestorm.rwf.app.map;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import java.util.List;

/** Read-only, main-thread diagnostics; metadata entries retain no decoded terrain. */
public interface MapLoading {
  record State(
      String id,
      Cuboid region,
      String blocksSha256,
      boolean decoded,
      boolean busy,
      boolean ready,
      int heldChunks,
      int preparations,
      int releases) {}

  List<State> states();
}
