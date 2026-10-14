package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.junit.jupiter.api.Test;

final class MinHeapTest {
  @Test
  void equalCostsKeepTheExistingRouteTieOrder() {
    var heap = new MinHeap(1);
    for (var node = 0; node < 5; node++) heap.push(1, node);
    for (var node : new int[] {0, 4, 3, 2, 1}) {
      assertThat(heap.peekKey()).isEqualTo(1);
      assertThat(heap.pop()).isEqualTo(node);
    }
    assertThat(heap.isEmpty()).isTrue();
  }

  @Test
  void mixedSearchFrontiersMatchTheFrozenOriginalOrderThroughGrowthAndClear()
      throws NoSuchAlgorithmException {
    var heap = new MinHeap(1);
    var digest = MessageDigest.getInstance("SHA-256");
    var state = 87378421L;
    var count = 0;
    for (var operation = 0; operation < 12000; operation++) {
      state = state * 6364136223846793005L + 1442695040888963407L;
      if (heap.isEmpty() || (state & 3) != 0) heap.push((float) ((state >>> 32) % 16), operation);
      else {
        digest.update(ByteBuffer.allocate(8).putFloat(heap.peekKey()).putInt(heap.pop()).array());
        count++;
      }
      if (operation % 271 == 270) heap.clear();
    }
    while (!heap.isEmpty()) {
      digest.update(ByteBuffer.allocate(8).putFloat(heap.peekKey()).putInt(heap.pop()).array());
      count++;
    }
    assertThat(count).isEqualTo(3028);
    // Captured from the original binary heap before its pop loop changed.
    assertThat(HexFormat.of().formatHex(digest.digest()))
        .isEqualTo("d0ce6c8bb8506731c06bdb41b15778bec4d5790842cacdea64b6268e7c3a307d");
  }
}
