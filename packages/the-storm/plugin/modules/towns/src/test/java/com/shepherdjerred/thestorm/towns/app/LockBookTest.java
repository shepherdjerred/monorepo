package com.shepherdjerred.thestorm.towns.app;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.lock.LockGrant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** The in-memory lock index: lookups by block anywhere in the world, counts, and its invariant. */
final class LockBookTest {

  private final LockBook book = new LockBook();

  private static Lock lock(UUID owner, BlockPos... blocks) {
    return Lock.of(UUID.randomUUID(), owner, Set.of(blocks));
  }

  @ParameterizedTest(name = "({0}, {1}, {2})")
  @CsvSource({
    "0, 0, 0",
    "-1, -64, -1",
    "29999999, 319, -29999999",
    "-29999999, -64, 29999999",
    "15, 2031, -16",
  })
  void everyBlockOfTheWorldHasItsOwnKey(int x, int y, int z) {
    var here = new BlockPos("world", x, y, z);
    book.put(lock(OWNER, here));

    assertThat(book.lockAt(here)).isPresent();
    for (var near :
        List.of(
            new BlockPos("world", x + 1, y, z),
            new BlockPos("world", x, y + 1, z),
            new BlockPos("world", x, y, z + 1),
            new BlockPos("world_nether", x, y, z))) {
      assertThat(book.lockAt(near)).as("%s", near).isEmpty();
    }
  }

  @Test
  void keysDoNotCollideAcrossANeighbourhood() {
    var keys = new HashSet<Long>();
    for (var x = -3; x <= 3; x++) {
      for (var y = -3; y <= 3; y++) {
        for (var z = -3; z <= 3; z++) {
          keys.add(LockBook.key(x, y, z));
        }
      }
    }
    assertThat(keys).hasSize(7 * 7 * 7);
  }

  @Test
  void countsFollowPutsReplacementsAndRemovals() {
    var chest = lock(OWNER, new BlockPos("world", 1, 64, 1), new BlockPos("world", 2, 64, 1));
    book.put(chest);
    book.put(lock(OWNER, new BlockPos("world", 5, 64, 5)));
    assertThat(book.countOf(OWNER)).isEqualTo(2);

    book.put(chest.withTrust(NOMAD, LockGrant.USE));
    assertThat(book.countOf(OWNER)).isEqualTo(2);
    assertThat(book.lockAt(new BlockPos("world", 2, 64, 1)).orElseThrow().trusted())
        .containsEntry(NOMAD, LockGrant.USE);

    book.put(chest.withoutBlock(new BlockPos("world", 2, 64, 1)));
    assertThat(book.lockAt(new BlockPos("world", 2, 64, 1))).isEmpty();

    book.remove(chest.id());
    assertThat(book.countOf(OWNER)).isEqualTo(1);
    assertThat(book.all()).hasSize(1);
  }

  @Test
  void aBlockHasOneLock() {
    var here = new BlockPos("world", 1, 64, 1);
    book.put(lock(OWNER, here));

    assertThatThrownBy(() -> book.put(lock(NOMAD, here))).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void aReloadReplacesEverything() {
    book.put(lock(OWNER, new BlockPos("world", 1, 64, 1)));
    var kept = lock(NOMAD, new BlockPos("world", 9, 64, 9));

    book.reload(List.of(kept));

    assertThat(book.all()).containsExactly(kept);
    assertThat(book.countOf(OWNER)).isZero();
    assertThat(book.byId(kept.id())).contains(kept);
  }
}
