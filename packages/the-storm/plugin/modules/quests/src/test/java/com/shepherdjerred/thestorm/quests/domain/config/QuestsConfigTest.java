package com.shepherdjerred.thestorm.quests.domain.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import java.nio.file.Path;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class QuestsConfigTest {

  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/quests.yml");
  static final QuestsConfig.Labels LABELS =
      new QuestsConfig.Labels("Accept", "Not now", "Hand over", "Back", "Goodbye", "Hi");

  @Test
  void theShippedConfigParses() {
    var config = ConfigFiles.load(SHIPPED, QuestsConfig.class);
    assertThat(config.calendar().zone()).isEqualTo(ZoneId.of("America/Los_Angeles"));
    assertThat(config.calendar().weekStart()).isEqualTo(DayOfWeek.MONDAY);
    assertThat(config.board().npc()).isEqualTo("quest-board");
    assertThat(config.party().activeSeconds()).isEqualTo(60);
    assertThat(config.mainWorld()).isEqualTo("world");
    assertThat(config.budget().limit(10)).isEqualTo(100 + 25 * 10);
    assertThat(config.placedBlockMemory()).isEqualTo(Duration.ofDays(7));
    assertThat(config.permissionConditions()).isEmpty();
    assertThat(config.party().radius()).isEqualTo(16);
  }

  @Test
  void nonsenseIsRejected() {
    var budget = new QuestsConfig.Budget(25, 100, 2000, 0.1, Map.of());
    var party = new QuestsConfig.Party(16, 60);
    var board = new QuestsConfig.BoardSettings("board", 3, 1);
    assertThatThrownBy(
            () ->
                new QuestsConfig(
                    "UTC", "MONDAY", "", budget, party, board, 40, 300, 7, List.of(), 8, 10,
                    LABELS))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new QuestsConfig(
                    "Mars/Olympus",
                    "MONDAY",
                    "world",
                    budget,
                    party,
                    board,
                    40,
                    300,
                    7,
                    List.of(),
                    8,
                    10,
                    LABELS))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new QuestsConfig(
                    "UTC", "FUNDAY", "world", budget, party, board, 40, 300, 7, List.of(), 8, 10,
                    LABELS))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new QuestsConfig(
                    "UTC", "MONDAY", "world", budget, party, board, 0, 300, 7, List.of(), 8, 10,
                    LABELS))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new QuestsConfig(
                    "UTC", "MONDAY", "world", budget, party, board, 40, 300, 7, List.of(), 15, 10,
                    LABELS))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new QuestsConfig(
                    "UTC", "MONDAY", "world", budget, party, board, 40, 300, 7, List.of(), 8, 0,
                    LABELS))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new QuestsConfig.Budget(-1, 0, 2000, 0.1, Map.of()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new QuestsConfig.Party(500, 60))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new QuestsConfig.Party(16, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new QuestsConfig.BoardSettings("", 1, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new QuestsConfig.BoardSettings("b", 6, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new QuestsConfig.Labels("x".repeat(33), "b", "c", "d", "e", "f"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new QuestsConfig.Labels("a", "b", "c", "d", "e", " "))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(
            new QuestsConfig(
                    "UTC", "sunday", "world", budget, party, board, 40, 300, 7, List.of(), 8, 10,
                    LABELS)
                .calendar()
                .weekStart())
        .isEqualTo(DayOfWeek.SUNDAY);
  }
}
