package com.shepherdjerred.thestorm.npcs.domain.markers;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.npcs.app.QuestMarker;
import com.shepherdjerred.thestorm.npcs.domain.markers.MarkerBoard.Change;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class MarkerBoardTest {

  private static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  private static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");

  @Test
  void markersArePerPlayerAndPerNpc() {
    var board = new MarkerBoard();
    board.set(ALICE, "stan", QuestMarker.AVAILABLE);
    board.set(BOB, "stan", QuestMarker.TURN_IN);
    board.set(ALICE, "nat", QuestMarker.TURN_IN);
    assertThat(board.get(ALICE, "stan")).isEqualTo(QuestMarker.AVAILABLE);
    assertThat(board.get(BOB, "stan")).isEqualTo(QuestMarker.TURN_IN);
    assertThat(board.get(BOB, "nat")).isEqualTo(QuestMarker.NONE);
    assertThat(board.of(ALICE))
        .isEqualTo(Map.of("stan", QuestMarker.AVAILABLE, "nat", QuestMarker.TURN_IN));
    assertThat(board.above("stan"))
        .isEqualTo(Map.of(ALICE, QuestMarker.AVAILABLE, BOB, QuestMarker.TURN_IN));
  }

  @Test
  void changesReportWhetherAnythingVisibleChanged() {
    var board = new MarkerBoard();
    var first = board.set(ALICE, "stan", QuestMarker.AVAILABLE);
    assertThat(first).isEqualTo(new Change(ALICE, "stan", QuestMarker.NONE, QuestMarker.AVAILABLE));
    assertThat(first.changed()).isTrue();
    assertThat(board.set(ALICE, "stan", QuestMarker.AVAILABLE).changed()).isFalse();
    assertThat(board.set(ALICE, "stan", QuestMarker.TURN_IN).before())
        .isEqualTo(QuestMarker.AVAILABLE);
  }

  @Test
  void noneClearsAndForgettingDropsEverything() {
    var board = new MarkerBoard();
    board.set(ALICE, "stan", QuestMarker.AVAILABLE);
    assertThat(board.set(ALICE, "stan", QuestMarker.NONE).changed()).isTrue();
    assertThat(board.of(ALICE)).isEmpty();
    assertThat(board.above("stan")).isEmpty();
    board.set(BOB, "nat", QuestMarker.TURN_IN);
    board.forget(BOB);
    assertThat(board.get(BOB, "nat")).isEqualTo(QuestMarker.NONE);
    assertThat(board.set(ALICE, "nat", QuestMarker.NONE).changed()).isFalse();
  }
}
