package com.shepherdjerred.thestorm.qol.domain.bank;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.qol.domain.bank.Shelving.Move;
import com.shepherdjerred.thestorm.qol.domain.bank.Shelving.Pile;
import com.shepherdjerred.thestorm.qol.domain.bank.Shelving.ShelfOpening;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class ShelvingTest {

  @Test
  void theFirstShelfThatAcceptsTheItemTakesIt() {
    var moves =
        Shelving.plan(
            List.of(new Pile("minecraft:stone", 10, 64, 0)),
            List.of(
                new ShelfOpening("logs", Set.of("minecraft:oak_log"), 1, Map.of()),
                new ShelfOpening("stone", Set.of("minecraft:stone"), 1, Map.of())));

    assertThat(moves).containsExactly(new Move(0, "stone", 10));
  }

  @Test
  void overflowStaysInTheBank() {
    var moves =
        Shelving.plan(
            List.of(new Pile("minecraft:stone", 70, 64, 2)),
            List.of(new ShelfOpening("stone", Set.of("minecraft:stone"), 1, Map.of())));

    assertThat(moves).containsExactly(new Move(2, "stone", 64));
  }

  @Test
  void partialStacksAreFilledBeforeAnEmptySlot() {
    var moves =
        Shelving.plan(
            List.of(new Pile("minecraft:stone", 10, 64, 0)),
            List.of(
                new ShelfOpening(
                    "stone", Set.of("minecraft:stone"), 0, Map.of("minecraft:stone", 4))));

    assertThat(moves).containsExactly(new Move(0, "stone", 4));
  }
}
