package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class StargateServerHubTest {
  @Test
  void landingSearchHoldsEveryChunkAcrossPositiveAndNegativeBoundaries() {
    assertEquals(
        Set.of(
            new StargateServerHub.Chunk(0, -1),
            new StargateServerHub.Chunk(0, 0),
            new StargateServerHub.Chunk(1, -1),
            new StargateServerHub.Chunk(1, 0)),
        StargateServerHub.landingChunks(new Pos(16, 64, 0), 9));
    assertEquals(
        Set.of(new StargateServerHub.Chunk(1, 0)),
        StargateServerHub.landingChunks(new Pos(16, 64, 0), 0));
  }
}
