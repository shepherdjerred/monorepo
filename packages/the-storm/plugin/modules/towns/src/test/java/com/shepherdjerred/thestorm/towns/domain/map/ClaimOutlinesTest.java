package com.shepherdjerred.thestorm.towns.domain.map;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Claimed chunks become outlines: one ring per connected piece, pockets as holes. */
final class ClaimOutlinesTest {

  private static List<ChunkPos> chunks(String world, int... xz) {
    var chunks = new ArrayList<ChunkPos>();
    for (var i = 0; i < xz.length; i += 2) {
      chunks.add(new ChunkPos(world, xz[i], xz[i + 1]));
    }
    return chunks;
  }

  private static Outline.Corner c(int x, int z) {
    return new Outline.Corner(x, z);
  }

  private static List<Outline> world(List<ChunkPos> chunks) {
    return requireNonNull(ClaimOutlines.of(chunks).get("world"));
  }

  @Test
  void oneChunkIsASquare() {
    var outlines = world(chunks("world", 2, -1));

    assertThat(outlines).hasSize(1);
    assertThat(outlines.getFirst().ring())
        .containsExactly(c(32, -16), c(48, -16), c(48, 0), c(32, 0));
    assertThat(outlines.getFirst().holes()).isEmpty();
  }

  @Test
  void aRowIsOneRectangleWithNoCornersInTheMiddle() {
    var ring = world(chunks("world", 0, 0, 1, 0, 2, 0)).getFirst().ring();

    assertThat(ring).containsExactly(c(0, 0), c(48, 0), c(48, 16), c(0, 16));
  }

  @Test
  void anLShapeHasSixCorners() {
    var ring = world(chunks("world", 0, 0, 1, 0, 0, 1)).getFirst().ring();

    assertThat(ring).hasSize(6);
    assertThat(ring)
        .containsExactlyInAnyOrder(c(0, 0), c(32, 0), c(32, 16), c(16, 16), c(16, 32), c(0, 32));
  }

  @Test
  void aRingAroundAnUnclaimedChunkHasAHole() {
    var ring = new ArrayList<ChunkPos>();
    for (var x = 0; x < 3; x++) {
      for (var z = 0; z < 3; z++) {
        if (x != 1 || z != 1) {
          ring.add(new ChunkPos("world", x, z));
        }
      }
    }

    var outlines = world(ring);

    assertThat(outlines).hasSize(1);
    assertThat(outlines.getFirst().ring())
        .containsExactlyInAnyOrder(c(0, 0), c(48, 0), c(48, 48), c(0, 48));
    assertThat(outlines.getFirst().holes()).hasSize(1);
    assertThat(outlines.getFirst().holes().getFirst())
        .containsExactlyInAnyOrder(c(16, 16), c(32, 16), c(32, 32), c(16, 32));
  }

  @Test
  void chunksTouchingOnlyAtACornerAreSeparatePieces() {
    var outlines = world(chunks("world", 0, 0, 1, 1));

    assertThat(outlines).hasSize(2);
    assertThat(outlines).allSatisfy(outline -> assertThat(outline.ring()).hasSize(4));
  }

  @Test
  void aPinchedRingKeepsItsHoleAndItsPieces() {
    // A 3x3 ring whose top-right corner is missing, plus a chunk touching the gap diagonally:
    // the ring stays one piece around its hole; the extra chunk is its own piece.
    var pinched = new ArrayList<ChunkPos>();
    for (var x = 0; x < 3; x++) {
      for (var z = 0; z < 3; z++) {
        if ((x != 1 || z != 1) && (x != 2 || z != 0)) {
          pinched.add(new ChunkPos("world", x, z));
        }
      }
    }
    pinched.add(new ChunkPos("world", 3, -1));

    var outlines = world(pinched);

    assertThat(outlines).hasSize(2);
    var totalHoles = outlines.stream().mapToInt(outline -> outline.holes().size()).sum();
    assertThat(totalHoles).isZero();
  }

  @Test
  void aHoleIsTheSmallestRingAroundIt() {
    // A 5x5 block with a 3x3 pocket that holds a 1x1 island: the island is its own piece and the
    // pocket is a hole of the outer ring only.
    var nested = new ArrayList<ChunkPos>();
    for (var x = 0; x < 5; x++) {
      for (var z = 0; z < 5; z++) {
        var inPocket = x >= 1 && x <= 3 && z >= 1 && z <= 3;
        if (!inPocket || (x == 2 && z == 2)) {
          nested.add(new ChunkPos("world", x, z));
        }
      }
    }

    var outlines = world(nested);

    assertThat(outlines).hasSize(2);
    var outer =
        outlines.stream()
            .filter(outline -> outline.ring().contains(c(0, 0)))
            .findFirst()
            .orElseThrow();
    var island =
        outlines.stream()
            .filter(outline -> outline.ring().contains(c(32, 32)))
            .findFirst()
            .orElseThrow();
    assertThat(outer.holes()).hasSize(1);
    assertThat(island.holes()).isEmpty();
    assertThat(island.ring()).containsExactlyInAnyOrder(c(32, 32), c(48, 32), c(48, 48), c(32, 48));
  }

  @Test
  void worldsAreOutlinedApart() {
    var all = new ArrayList<ChunkPos>(chunks("world", 0, 0));
    all.addAll(chunks("world_nether", 0, 0, 0, 1));

    var outlines = ClaimOutlines.of(all);

    assertThat(outlines.keySet()).containsExactly("world", "world_nether");
    assertThat(requireNonNull(outlines.get("world_nether")).getFirst().ring())
        .containsExactly(c(0, 0), c(16, 0), c(16, 32), c(0, 32));
  }

  @Test
  void theSameLandAlwaysGivesTheSameOutline() {
    var land = chunks("world", 0, 0, 1, 0, 1, 1, 5, 5);
    var reversed = new ArrayList<>(land).reversed();

    assertThat(ClaimOutlines.of(land)).isEqualTo(ClaimOutlines.of(reversed));
    assertThat(ClaimOutlines.of(Set.of())).isEmpty();
  }

  @Test
  void aRingNeedsFourCorners() {
    assertThatThrownBy(() -> new Outline(List.of(c(0, 0), c(1, 1)), List.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
