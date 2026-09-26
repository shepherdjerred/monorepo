package com.shepherdjerred.thestorm.quests.domain.board;

import static com.shepherdjerred.thestorm.quests.domain.Fixtures.CALENDAR;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.state.Board;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class BoardQuestsTest {

  static final Template BOUNTY =
      new Template(
          "bounty",
          Template.Period.DAILY,
          Template.Kind.KILL,
          "Bounty: {amount} {target}",
          "Kill {amount} {target}s.",
          "Good hunting.",
          "Later.",
          "Here's the bounty.",
          40,
          List.of(
              new Template.Target("ZOMBIE", 1.0, 8, 16, 4, 0.5),
              new Template.Target("SKELETON", 1.2, 6, 12, 5, 0.6)));

  static final Template SUPPLY =
      new Template(
          "supply",
          Template.Period.WEEKLY,
          Template.Kind.DELIVER,
          "Supply: {amount} {target}",
          "Bring {amount} {target}.",
          "Thanks.",
          "Later.",
          "Stocked.",
          150,
          List.of(new Template.Target("IRON_INGOT", 1.0, 32, 48, 5, 0.6)));

  static final Template TIMBER =
      new Template(
          "timber",
          Template.Period.DAILY,
          Template.Kind.DELIVER,
          "Timber: {amount} {target}",
          "Bring {amount} {target}.",
          "Thanks.",
          "Later.",
          "Stacked.",
          40,
          List.of(new Template.Target("OAK_LOG", 0.2, 16, 48, 1, 0.1)));

  static final Map<String, Template> TEMPLATES =
      Map.of("bounty", BOUNTY, "supply", SUPPLY, "timber", TIMBER);

  // Wednesday 2026-09-23, noon in Los Angeles.
  static final Instant WEDNESDAY = Instant.parse("2026-09-23T19:00:00Z");

  @Test
  void drawsAreDeterministicAndWithinTheTable() {
    for (var seed = 0L; seed < 200; seed++) {
      var draw = BoardQuests.draw(BOUNTY, seed);
      assertThat(draw).isEqualTo(BoardQuests.draw(BOUNTY, seed));
      assertThat(draw.amount()).isBetween(draw.target().min(), draw.target().max());
      assertThat(draw.stars()).isBetween(1, 5);
    }
    var targets =
        java.util.stream.LongStream.range(0, 200)
            .mapToObj(seed -> BoardQuests.draw(BOUNTY, seed).target().id())
            .distinct()
            .toList();
    assertThat(targets).containsExactlyInAnyOrder("ZOMBIE", "SKELETON");
  }

  @Test
  void starsAndRewardsScaleWithEffort() {
    assertThat(BoardQuests.stars(0.5)).isEqualTo(1);
    assertThat(BoardQuests.stars(10)).isEqualTo(2);
    assertThat(BoardQuests.stars(39.9)).isEqualTo(4);
    assertThat(BoardQuests.stars(500)).isEqualTo(5);
    var zombie = BOUNTY.targets().getFirst();
    var small = BoardQuests.priced(BOUNTY, zombie, 8);
    assertThat(small.stars()).isEqualTo(1);
    assertThat(small.reward()).isEqualTo(40 + 32);
    var big = BoardQuests.priced(BOUNTY, zombie, 16);
    assertThat(big.stars()).isEqualTo(2);
    assertThat(big.reward()).isEqualTo(Math.round((40 + 64) * 1.1));
    assertThat(BoardQuests.minutes(zombie, 16)).isEqualTo(8);
    assertThat(BoardQuests.minutes(zombie, 1)).isEqualTo(1);
  }

  @Test
  void killQuestsReportBackAndDeliverQuestsHandInAtTheBoard() {
    var kill = BoardQuests.quest(BOUNTY, new Board.Entry("daily-1", "bounty", 3), "board");
    assertThat(kill.id()).isEqualTo("daily-1");
    assertThat(kill.giver()).isEqualTo("board");
    assertThat(kill.category()).isEqualTo(Quest.Category.DAILY);
    assertThat(kill.repeat()).isEqualTo(Quest.Repeat.DAILY);
    assertThat(kill.stage("hunt").orElseThrow().objectives().getFirst())
        .isInstanceOf(Objective.Kill.class);
    assertThat(kill.stage("report").orElseThrow().objectives())
        .containsExactly(new Objective.Talk("board", java.util.Optional.empty()));
    assertThat(kill.name()).startsWith("Bounty: ");
    assertThat(kill.text().offer()).contains("(Difficulty: ");
    var deliver = BoardQuests.quest(SUPPLY, new Board.Entry("weekly-1", "supply", 9), "board");
    assertThat(deliver.repeat()).isEqualTo(Quest.Repeat.WEEKLY);
    assertThat(deliver.start()).isEqualTo("gather");
    assertThat(deliver.rewards()).contains(new Action.Points(1));
  }

  @Test
  void aNewPlayerGetsAFullBoard() {
    var refresh =
        BoardQuests.refresh(
            Board.EMPTY,
            WEDNESDAY,
            new BoardQuests.Pool(CALENDAR, TEMPLATES, 3, 1),
            new SplittableRandom(1));
    var board = refresh.board();
    assertThat(board.day()).isEqualTo("2026-09-23");
    assertThat(board.week()).isEqualTo("2026-09-21");
    assertThat(board.entries())
        .extracting(Board.Entry::slot)
        .containsExactly("daily-1", "daily-2", "daily-3", "weekly-1");
    assertThat(board.entry("weekly-1").orElseThrow().template()).isEqualTo("supply");
    // Two daily templates: the first two dailies differ, the third repeats one.
    assertThat(
            List.of(
                board.entry("daily-1").orElseThrow().template(),
                board.entry("daily-2").orElseThrow().template()))
        .containsExactlyInAnyOrder("bounty", "timber");
    assertThat(refresh.expired()).isEmpty();
  }

  @Test
  void theSameDayKeepsTheBoardANewDayRedrawsDailiesANewWeekRedrawsAll() {
    var pool = new BoardQuests.Pool(CALENDAR, TEMPLATES, 2, 1);
    var random = new SplittableRandom(2);
    var first = BoardQuests.refresh(Board.EMPTY, WEDNESDAY, pool, random).board();
    var sameDay = BoardQuests.refresh(first, WEDNESDAY.plusSeconds(3600), pool, random);
    assertThat(sameDay.board()).isEqualTo(first);
    assertThat(sameDay.expired()).isEmpty();
    var thursday = BoardQuests.refresh(first, WEDNESDAY.plusSeconds(86_400), pool, random);
    assertThat(thursday.expired()).containsExactlyInAnyOrder("daily-1", "daily-2");
    assertThat(thursday.board().entry("weekly-1")).isEqualTo(first.entry("weekly-1"));
    assertThat(thursday.board().day()).isEqualTo("2026-09-24");
    var monday = BoardQuests.refresh(first, Instant.parse("2026-09-28T07:00:00Z"), pool, random);
    assertThat(monday.expired()).containsExactlyInAnyOrder("daily-1", "daily-2", "weekly-1");
    assertThat(monday.board().week()).isEqualTo("2026-09-28");
  }

  @Test
  void noTemplatesMeansNoQuests() {
    var refresh =
        BoardQuests.refresh(
            Board.EMPTY,
            WEDNESDAY,
            new BoardQuests.Pool(CALENDAR, Map.of(), 3, 1),
            new SplittableRandom(3));
    assertThat(refresh.board().entries()).isEmpty();
  }

  @Test
  void templatesRejectNonsense() {
    assertThatThrownBy(() -> new Template.Target("X", 0, 1, 2, 1, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Template.Target("X", 1, 3, 2, 1, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new Template(
                    "t",
                    Template.Period.DAILY,
                    Template.Kind.KILL,
                    "n",
                    "o",
                    "a",
                    "d",
                    "f",
                    1,
                    List.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
