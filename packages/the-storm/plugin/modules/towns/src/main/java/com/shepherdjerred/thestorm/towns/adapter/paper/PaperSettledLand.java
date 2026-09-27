package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.SettledLand;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import java.util.ArrayList;
import java.util.List;

/** {@link SettledLand} over the in-memory towns state. Main thread only. */
public final class PaperSettledLand implements SettledLand {

  private final TownsState state;

  public PaperSettledLand(TownsState state) {
    this.state = state;
  }

  @Override
  public List<Chunk> chunks(String world) {
    var chunks = new ArrayList<Chunk>();
    for (var chunk : state.settledChunks(world)) {
      chunks.add(new Chunk(chunk.x(), chunk.z()));
    }
    return List.copyOf(chunks);
  }
}
