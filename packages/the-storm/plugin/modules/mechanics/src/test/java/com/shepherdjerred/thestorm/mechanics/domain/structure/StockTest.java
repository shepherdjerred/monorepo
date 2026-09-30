package com.shepherdjerred.thestorm.mechanics.domain.structure;

import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.PLANKS;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.SPRUCE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Optional;
import org.junit.jupiter.api.Test;

final class StockTest {

  @Test
  void anEmptyStockNamesNoMaterial() {
    assertThat(Stock.of(PLANKS, 0)).isEqualTo(Stock.empty());
    assertThat(Stock.empty().accepts(SPRUCE)).isTrue();
    assertThatThrownBy(() -> new Stock(Optional.of(PLANKS), 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Stock(Optional.empty(), 3))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Stock.of(PLANKS, -1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Stock.of("planks", 1)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aStockHoldsOneMaterial() {
    var planks = Stock.of(PLANKS, 3);

    assertThat(planks.accepts(PLANKS)).isTrue();
    assertThat(planks.accepts(SPRUCE)).isFalse();
    assertThat(planks.plus(PLANKS, 2)).isEqualTo(Stock.of(PLANKS, 5));
    assertThatThrownBy(() -> planks.plus(SPRUCE, 1)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void takingEverythingEmptiesIt() {
    assertThat(Stock.of(PLANKS, 3).minus(1)).isEqualTo(Stock.of(PLANKS, 2));
    assertThat(Stock.of(PLANKS, 3).minus(3)).isEqualTo(Stock.empty());
    assertThatThrownBy(() -> Stock.of(PLANKS, 3).minus(4))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aStockHoldsAtMostMax() {
    var full = Stock.of(PLANKS, Stock.MAX);

    assertThat(full.hasRoomFor(0)).isTrue();
    assertThat(full.hasRoomFor(1)).isFalse();
    assertThat(Stock.of(PLANKS, 10).hasRoomFor(Stock.MAX - 10)).isTrue();
    assertThat(Stock.of(PLANKS, 10).hasRoomFor(Long.MAX_VALUE)).isFalse();
    assertThatThrownBy(() -> full.plus(PLANKS, 1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Stock.of(PLANKS, Stock.MAX + 1))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
