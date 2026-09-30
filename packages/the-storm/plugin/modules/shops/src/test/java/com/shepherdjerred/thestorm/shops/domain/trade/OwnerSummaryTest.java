package com.shepherdjerred.thestorm.shops.domain.trade;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class OwnerSummaryTest {

  private static final UUID OWNER = new UUID(0, 1);
  private static final UUID BOB = new UUID(0, 2);

  private static TradeRecord trade(Direction direction, String material, int quantity, long price) {
    return new TradeRecord(
        new TradeSite.Chest(1, OWNER),
        BOB,
        "Bob",
        direction,
        material,
        quantity,
        price,
        Instant.EPOCH);
  }

  @Test
  void groupsByItemAndDirectionAndTotalsCrystals() {
    var summary =
        OwnerSummary.of(
            List.of(
                trade(Direction.BUY, "coal", 16, 48),
                trade(Direction.BUY, "coal", 16, 48),
                trade(Direction.SELL, "emerald", 4, 40),
                trade(Direction.BUY, "diamond", 1, 200)),
            5);

    assertThat(summary.trades()).isEqualTo(4);
    assertThat(summary.earned()).isEqualTo(296);
    assertThat(summary.spent()).isEqualTo(40);
    assertThat(summary.lines())
        .containsExactly(
            new OwnerSummary.Line(Direction.BUY, "diamond", 1, 200),
            new OwnerSummary.Line(Direction.BUY, "coal", 32, 96),
            new OwnerSummary.Line(Direction.SELL, "emerald", 4, 40));
    assertThat(summary.more()).isZero();
  }

  @Test
  void keepsTheLargestLinesAndCountsTheRest() {
    var summary =
        OwnerSummary.of(
            List.of(
                trade(Direction.BUY, "a", 1, 1),
                trade(Direction.BUY, "b", 1, 3),
                trade(Direction.BUY, "c", 1, 2)),
            2);

    assertThat(summary.lines()).extracting(OwnerSummary.Line::material).containsExactly("b", "c");
    assertThat(summary.more()).isEqualTo(1);
  }

  @Test
  void tiesAreOrderedByDirectionThenItem() {
    var summary =
        OwnerSummary.of(
            List.of(
                trade(Direction.SELL, "a", 1, 5),
                trade(Direction.BUY, "b", 1, 5),
                trade(Direction.BUY, "a", 1, 5)),
            5);

    assertThat(summary.lines())
        .extracting(line -> line.direction() + ":" + line.material())
        .containsExactly("BUY:a", "BUY:b", "SELL:a");
  }

  @Test
  void anEmptyLogIsAnEmptySummary() {
    var summary = OwnerSummary.of(List.of(), 5);

    assertThat(summary.isEmpty()).isTrue();
    assertThat(summary.lines()).isEmpty();
  }

  @Test
  void needsRoomForALine() {
    assertThatThrownBy(() -> OwnerSummary.of(List.of(), 0))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void tradesMoveSomething() {
    assertThatThrownBy(() -> trade(Direction.BUY, "coal", 0, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> trade(Direction.BUY, "coal", 1, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
