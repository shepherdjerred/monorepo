package com.shepherdjerred.thestorm.towns.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlags;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class SettledChunksTest {

  @Test
  void claimsInTheWorldAreSettled() {
    var state = new TownsState(new RegionIndex(List.of()));
    var founder = UUID.randomUUID();
    var town = Town.found(UUID.randomUUID(), "Spawn", Instant.EPOCH, founder);
    state.addTown(town);
    state.addClaim(new Claim(new ChunkPos("world", 3, 4), town.id(), ClaimFlags.none()));
    assertThat(state.settledChunks("world")).containsExactly(new ChunkPos("world", 3, 4));
    assertThat(state.settledChunks("wilds")).isEmpty();
  }
}
