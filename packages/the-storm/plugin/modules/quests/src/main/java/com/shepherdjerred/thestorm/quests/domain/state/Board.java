package com.shepherdjerred.thestorm.quests.domain.state;

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
   * One drawn quest. Its quest is generated again from the template and seed whenever needed.
   *
   * @param slot the quest id on the board, such as {@code daily-1}
   * @param template the template it was drawn from
   * @param seed the random seed that picked its target and amount
   */
  public record Entry(String slot, String template, long seed) {}
}
