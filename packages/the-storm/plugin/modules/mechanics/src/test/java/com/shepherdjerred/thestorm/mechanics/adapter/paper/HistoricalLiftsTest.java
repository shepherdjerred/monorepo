package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import com.shepherdjerred.thestorm.core.protection.Protection;
import java.io.BufferedReader;
import java.io.StringReader;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import org.bukkit.block.Block;
import org.junit.jupiter.api.Test;

final class HistoricalLiftsTest {
  private static final String ROW = "world,1,2,3,af1c824a-8ff5-4912-9470-b32c07ffd1f8,[Lift Up]";

  @Test
  void unfinishedOrFailedCatalogDoesNotTouchTheSign() {
    var catalog = new CompletableFuture<Map<HistoricalLifts.Position, HistoricalLifts.Entry>>();
    var block = mock(Block.class);
    var lifts = new HistoricalLifts(catalog, mock(Signs.class), mock(Protection.class));
    lifts.bind(block);
    catalog.completeExceptionally(new IllegalStateException("unavailable"));
    lifts.bind(block);
    verifyNoInteractions(block);
  }

  @Test
  void catalogContainsTheSurveyedLifts() {
    assertThat(HistoricalLifts.load()).hasSize(70);
    assertThat(
            requireNonNull(
                    HistoricalLifts.load().get(new HistoricalLifts.Position("world", 59, 69, -34)))
                .fourthLine())
        .isEqualTo("2nd Floor");
    assertThat(
            requireNonNull(
                    HistoricalLifts.load()
                        .get(new HistoricalLifts.Position("map2", -492, 197, 2533)))
                .thirdLine())
        .isEqualTo("B");
  }

  @Test
  void duplicatePositionsAndOtherMechanismsAreRejected() {
    assertThatThrownBy(
            () -> HistoricalLifts.read(new BufferedReader(new StringReader(ROW + "\n" + ROW))))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                HistoricalLifts.read(
                    new BufferedReader(new StringReader(ROW.replace("[Lift Up]", "[Gate]")))))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
