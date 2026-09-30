package com.shepherdjerred.thestorm.quests.domain.board;

import static java.util.Comparator.comparing;

import com.shepherdjerred.thestorm.quests.domain.engine.Calendar;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Condition;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.model.Stage;
import com.shepherdjerred.thestorm.quests.domain.state.Board;
import com.shepherdjerred.thestorm.quests.domain.view.Names;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.random.RandomGenerator;

/**
 * The radiant board: which daily and weekly quests a player gets, and the quest each board entry
 * stands for. Board quests are {@code daily-N} and {@code weekly-N}; a new day (or week) draws new
 * ones and drops the old, taken or not, as the 2017 design had it.
 */
public final class BoardQuests {

  /** Slot ids for daily board quests start with this. */
  public static final String DAILY_PREFIX = "daily-";

  /** Slot ids for weekly board quests start with this. */
  public static final String WEEKLY_PREFIX = "weekly-";

  /** Stars at or above this also pay a quest point. */
  public static final int POINT_STARS = 4;

  /** Effort (difficulty × amount) per star. */
  static final double EFFORT_PER_STAR = 10.0;

  /** Each star above one adds this share of the reward. */
  static final double STAR_BONUS = 0.1;

  private BoardQuests() {}

  /**
   * What a board entry asks for.
   *
   * @param target the chosen row
   * @param amount how many
   * @param stars the difficulty, 1 to 5
   * @param reward the crystals it pays
   */
  public record Draw(Template.Target target, int amount, int stars, long reward) {}

  /**
   * What boards are drawn from.
   *
   * @param calendar days and weeks in the server's time zone
   * @param templates every template by id
   * @param dailies how many daily quests each player gets
   * @param weeklies how many weekly quests each player gets
   */
  public record Pool(
      Calendar calendar, Map<String, Template> templates, int dailies, int weeklies) {
    public Pool {
      templates = Map.copyOf(templates);
      if ((dailies > 0
              && templates.values().stream().noneMatch(t -> t.period() == Template.Period.DAILY))
          || (weeklies > 0
              && templates.values().stream()
                  .noneMatch(t -> t.period() == Template.Period.WEEKLY))) {
        throw new IllegalArgumentException(
            "every enabled board period needs at least one template");
      }
    }
  }

  /**
   * A new board and the slots that expired, when the day or week has turned.
   *
   * @param board the board to keep
   * @param expired slots whose quests must be dropped
   */
  public record Refresh(Board board, List<String> expired) {}

  /** Draws target and amount for {@code seed}. */
  public static Draw draw(Template template, long seed) {
    var random = new SplitMix(seed);
    var target = template.targets().get(random.nextInt(template.targets().size()));
    var amount = target.min() + random.nextInt(target.max() - target.min() + 1);
    return priced(template, target, amount);
  }

  /** The stars and reward for {@code amount} of {@code target}. */
  public static Draw priced(Template template, Template.Target target, int amount) {
    var stars = stars(target.difficulty() * amount);
    var base = Math.addExact(template.baseReward(), Math.multiplyExact(target.reward(), amount));
    var scaled = base * (1 + STAR_BONUS * (stars - 1));
    if (!Double.isFinite(scaled) || scaled >= 0x1.0p63) {
      throw new IllegalArgumentException("board reward exceeds the supported range");
    }
    var reward = Math.round(scaled);
    return new Draw(target, amount, stars, reward);
  }

  /** The stars for {@code effort}, 1 to 5. */
  public static int stars(double effort) {
    return (int) Math.max(1, Math.min(5, 1 + Math.floor(effort / EFFORT_PER_STAR)));
  }

  /** The estimated minutes for {@code amount} of {@code target}. */
  public static int minutes(Template.Target target, int amount) {
    var minutes = Math.ceil(target.minutes() * amount);
    if (!Double.isFinite(minutes) || minutes > Integer.MAX_VALUE) {
      throw new IllegalArgumentException("board duration exceeds the supported range");
    }
    return (int) Math.max(1, minutes);
  }

  /** A board entry for {@code slot} snapshotting {@code draw}. */
  public static Board.Entry entry(String slot, Template template, Draw draw) {
    return new Board.Entry(
        slot,
        template.id(),
        template.period(),
        template.kind(),
        draw.target().id(),
        draw.amount(),
        draw.stars(),
        draw.reward(),
        minutes(draw.target(), draw.amount()));
  }

  /** The quest a board entry stands for; text comes from the template, the rest from the entry. */
  public static Quest quest(Template template, Board.Entry entry, String npc) {
    var name = fill(template.name(), entry);
    var offer = fill(template.offer(), entry) + " (Difficulty: " + entry.stars() + "/5)";
    var target = entry.target();
    var amount = entry.amount();
    var stages =
        switch (entry.kind()) {
          case KILL ->
              Map.of(
                  "hunt",
                  stage(
                      "hunt",
                      "Kill " + amount + " " + Names.pretty(target) + ".",
                      new Objective.Kill(target, amount, Optional.empty()),
                      "report"),
                  "report",
                  stage(
                      "report",
                      "Report back to the quest board.",
                      new Objective.Talk(npc, Optional.empty()),
                      Stage.COMPLETE));
          case DELIVER ->
              Map.of(
                  "gather",
                  stage(
                      "gather",
                      "Bring " + amount + " " + Names.pretty(target) + ".",
                      new Objective.Deliver(npc, ItemMatch.of(target), amount, Optional.empty()),
                      Stage.COMPLETE));
        };
    var rewards = new ArrayList<Action>();
    if (entry.reward() > 0) {
      rewards.add(new Action.Crystals(entry.reward()));
    }
    if (entry.stars() >= POINT_STARS) {
      rewards.add(new Action.Points(1));
    }
    var daily = entry.period() == Template.Period.DAILY;
    return new Quest(
        entry.slot(),
        name,
        npc,
        daily ? Quest.Category.DAILY : Quest.Category.WEEKLY,
        daily ? Quest.Repeat.DAILY : Quest.Repeat.WEEKLY,
        entry.minutes(),
        List.<Condition>of(),
        new Quest.QuestText(
            offer, template.accept(), template.decline(), template.finish(), name, List.of()),
        entry.kind() == Template.Kind.KILL ? "hunt" : "gather",
        stages,
        List.of(),
        rewards);
  }

  /**
   * The board for {@code now}: unchanged if the day and week have not turned; otherwise the expired
   * half is drawn again with seeds and templates from {@code random}.
   */
  public static Refresh refresh(Board current, Instant now, Pool pool, RandomGenerator random) {
    var day = pool.calendar().day(now).toString();
    var week = pool.calendar().week(now).toString();
    var entries = new ArrayList<Board.Entry>();
    var expired = new ArrayList<String>();
    var redrawDaily = !day.equals(current.day());
    var redrawWeekly = !week.equals(current.week());
    for (var entry : current.entries()) {
      var weekly = entry.slot().startsWith(WEEKLY_PREFIX);
      if (weekly ? redrawWeekly : redrawDaily) {
        expired.add(entry.slot());
      } else {
        entries.add(entry);
      }
    }
    if (redrawDaily) {
      entries.addAll(
          drawSlots(
              DAILY_PREFIX, pool.dailies(), pool(pool.templates(), Template.Period.DAILY), random));
    }
    if (redrawWeekly) {
      entries.addAll(
          drawSlots(
              WEEKLY_PREFIX,
              pool.weeklies(),
              pool(pool.templates(), Template.Period.WEEKLY),
              random));
    }
    entries.sort(comparing(Board.Entry::slot));
    return new Refresh(new Board(day, week, entries), expired);
  }

  private static List<Board.Entry> drawSlots(
      String prefix, int count, List<Template> pool, RandomGenerator random) {
    var drawn = new ArrayList<Board.Entry>();
    var used = new HashSet<String>();
    for (var slot = 1; slot <= count; slot++) {
      var candidates = pool.stream().filter(template -> !used.contains(template.id())).toList();
      if (candidates.isEmpty()) {
        candidates = pool;
      }
      var template = candidates.get(random.nextInt(candidates.size()));
      used.add(template.id());
      drawn.add(entry(prefix + slot, template, draw(template, random.nextLong())));
    }
    return drawn;
  }

  private static List<Template> pool(Map<String, Template> templates, Template.Period period) {
    return templates.values().stream()
        .filter(template -> template.period() == period)
        .sorted(comparing(Template::id))
        .toList();
  }

  private static Stage stage(String id, String journal, Objective objective, String next) {
    return new Stage(
        id,
        journal,
        Optional.empty(),
        Optional.empty(),
        List.of(objective),
        List.of(),
        new Stage.Next.Guarded(List.of(new Stage.Branch(next, List.of()))),
        Optional.empty());
  }

  private static String fill(String text, Board.Entry entry) {
    return text.replace("{amount}", Integer.toString(entry.amount()))
        .replace("{target}", Names.pretty(entry.target()));
  }
}
