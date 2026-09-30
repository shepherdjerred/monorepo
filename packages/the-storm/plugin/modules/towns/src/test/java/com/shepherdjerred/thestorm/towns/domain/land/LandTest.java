package com.shepherdjerred.thestorm.towns.domain.land;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_B;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** Positions, flags, claims and land ownership. */
final class LandTest {

  @ParameterizedTest(name = "block ({0}, {1}) is in chunk ({2}, {3})")
  @CsvSource({
    "0, 0, 0, 0",
    "15, 15, 0, 0",
    "16, -1, 1, -1",
    "-1, -16, -1, -1",
    "-17, 31, -2, 1",
    "-2147483648, 2147483647, -134217728, 134217727"
  })
  void blocksMapToTheirChunk(int x, int z, int chunkX, int chunkZ) {
    assertThat(ChunkPos.ofBlock("world", x, z)).isEqualTo(new ChunkPos("world", chunkX, chunkZ));
    assertThat(new BlockPos("world", x, 64, z).chunk())
        .isEqualTo(new ChunkPos("world", chunkX, chunkZ));
  }

  @Test
  void chunksAreValuesSoTheyWorkAsMapKeys() {
    var chunks = new HashSet<ChunkPos>();
    chunks.add(new ChunkPos("world", 1, 2));
    chunks.add(new ChunkPos("world", 1, 2));
    chunks.add(new ChunkPos("world_nether", 1, 2));

    assertThat(chunks).hasSize(2);
  }

  @Test
  void packedKeysAreUniqueNearTheOriginAndAtTheExtremes() {
    var keys = new HashSet<Long>();
    for (var x = -3; x <= 3; x++) {
      for (var z = -3; z <= 3; z++) {
        keys.add(ChunkPos.key(x, z));
      }
    }
    keys.add(ChunkPos.key(Integer.MIN_VALUE, Integer.MAX_VALUE));
    keys.add(ChunkPos.key(Integer.MAX_VALUE, Integer.MIN_VALUE));

    assertThat(keys).hasSize(49 + 2);
    assertThat(new ChunkPos("world", -1, -1).key()).isEqualTo(ChunkPos.key(-1, -1));
  }

  @Test
  void adjacencyMeansSharingAnEdgeInTheSameWorld() {
    var origin = new ChunkPos("world", 0, 0);

    assertThat(origin.edgeNeighbours())
        .allSatisfy(neighbour -> assertThat(origin.isEdgeAdjacentTo(neighbour)).isTrue())
        .hasSize(4);
    assertThat(origin.isEdgeAdjacentTo(new ChunkPos("world", 1, 1))).isFalse();
    assertThat(origin.isEdgeAdjacentTo(origin)).isFalse();
    assertThat(origin.isEdgeAdjacentTo(new ChunkPos("world_nether", 1, 0))).isFalse();
  }

  @Test
  void aSquareHoldsEveryChunkWithinTheDistance() {
    var square = new ChunkPos("world", 5, 5).square(2);

    assertThat(square)
        .hasSize(25)
        .contains(new ChunkPos("world", 3, 7), new ChunkPos("world", 5, 5));
    assertThat(new ChunkPos("world", 0, 0).square(0)).containsExactly(new ChunkPos("world", 0, 0));
    assertThatThrownBy(() -> new ChunkPos("world", 0, 0).square(-1))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void blankWorldsAreRejected() {
    assertThatThrownBy(() -> new ChunkPos(" ", 0, 0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new BlockPos("", 0, 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void flagsSwitchIndependently() {
    var flags = ClaimFlags.none().with(ClaimFlag.PVP, true).with(ClaimFlag.EXPLOSIONS, true);

    assertThat(flags.enabled()).containsExactlyInAnyOrder(ClaimFlag.PVP, ClaimFlag.EXPLOSIONS);
    assertThat(flags.with(ClaimFlag.PVP, false)).isEqualTo(ClaimFlags.of(ClaimFlag.EXPLOSIONS));
    assertThat(flags.with(ClaimFlag.PVP, true)).isEqualTo(flags);
    assertThat(ClaimFlags.none().with(ClaimFlag.PVP, false)).isEqualTo(ClaimFlags.none());
    assertThat(new ClaimFlags(Set.of(ClaimFlag.PVP))).isEqualTo(ClaimFlags.of(ClaimFlag.PVP));
  }

  @Test
  void landKnowsItsOwner() {
    var wild = new Land.Wilderness();
    var a1 = Fixtures.land(TOWN_A);
    var a2 = new Land.TownLand(Fixtures.claim(TOWN_A, 9, 9, ClaimFlag.PVP));
    var b = Fixtures.land(TOWN_B);
    var spawn = new Land.RegionLand(Fixtures.region("spawn"));

    assertThat(wild.owner()).isEmpty();
    assertThat(a1.owner()).contains(new Owner.OfTown(TOWN_A));
    assertThat(spawn.owner()).contains(new Owner.OfRegion("spawn"));
    assertThat(wild.sameOwnerAs(new Land.Wilderness())).isTrue();
    assertThat(a1.sameOwnerAs(a2)).isTrue();
    assertThat(a1.sameOwnerAs(b)).isFalse();
    assertThat(a1.sameOwnerAs(wild)).isFalse();
    assertThat(spawn.sameOwnerAs(new Land.RegionLand(Fixtures.region("spawn")))).isTrue();
    assertThat(spawn.sameOwnerAs(new Land.RegionLand(Fixtures.region("arena")))).isFalse();
  }
}
