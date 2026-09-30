package com.shepherdjerred.thestorm.quests.domain.state;

import com.shepherdjerred.thestorm.quests.domain.board.Template;
import java.util.List;
import java.util.Optional;

/**
 * A player's quest board: the daily and weekly quests drawn for the current day and week.
 *
 * @param day the local date the dailies were drawn for ({@code YYYY-MM-DD}), or empty if never
 * @param week the first day of the week the weeklies were drawn for, or empty if never
 * @param entries the drawn quests
 */
public record Board(String day, String week, List<Entry> entries) {

  /** A board nobody has drawn yet. */
  public static final Board EMPTY = new Board("", "", List.of());

  public Board {
    entries = List.copyOf(entries);
  }

  /** The entry in {@code slot}, if any. */
  public Optional<Entry> entry(String slot) {
    return entries.stream().filter(entry -> entry.slot().equals(slot)).findFirst();
  }

  /**
   * One drawn quest, snapshotted when drawn: later template edits change its text but not what it
   * asks for or pays.
   *
   * @param slot the quest id on the board, such as {@code daily-1}
   * @param template the template it was drawn from
   * @param period whether this is a daily or weekly quest
   * @param kind whether the objective is a kill or delivery
   * @param target the entity type or material it asks for
   * @param amount how many
   * @param stars its difficulty, 1 to 5
   * @param reward the crystals it pays
   * @param minutes its estimated minutes
   */
  public record Entry(
      String slot,
      String template,
      Template.Period period,
      Template.Kind kind,
      String target,
      int amount,
      int stars,
      long reward,
      int minutes) {

    public Entry {
      if (amount < 1 || stars < 1 || stars > 5 || reward < 0 || minutes < 1) {
        throw new IllegalArgumentException("a board entry needs a positive amount and minutes");
      }
    }
  }
}
