package com.shepherdjerred.thestorm.quests.domain.board;

import java.util.List;

/**
 * A kind of board quest and the table it draws from, after the 2017 Dynamic Quest Board design:
 * each target has a difficulty, a range of amounts and a reward per unit.
 *
 * @param id the template id
 * @param period whether it is a daily or weekly quest
 * @param kind kill (then report to the board) or deliver (to the board)
 * @param name the quest name; {@code {amount}} and {@code {target}} are filled in
 * @param offer the offer; the same placeholders
 * @param accept what the board NPC says when the quest is taken
 * @param decline what the board NPC says when it is declined
 * @param finish what the board NPC says on completion
 * @param baseReward crystals on top of the per-unit reward
 * @param targets what it may ask for
 */
public record Template(
    String id,
    Period period,
    Kind kind,
    String name,
    String offer,
    String accept,
    String decline,
    String finish,
    long baseReward,
    List<Target> targets) {

  public Template {
    targets = List.copyOf(targets);
    if (targets.isEmpty()) {
      throw new IllegalArgumentException("a board template needs targets");
    }
    if (baseReward < 0) {
      throw new IllegalArgumentException("a base reward cannot be negative");
    }
  }

  /** How long a board quest lasts. */
  public enum Period {
    DAILY,
    WEEKLY
  }

  /** What a board quest asks for. */
  public enum Kind {
    KILL,
    DELIVER
  }

  /**
   * A row of the table.
   *
   * @param id an entity type (kill) or material (deliver)
   * @param difficulty how hard one unit is
   * @param min the fewest asked for
   * @param max the most asked for
   * @param reward crystals per unit
   * @param minutes estimated minutes per unit
   */
  public record Target(
      String id, double difficulty, int min, int max, long reward, double minutes) {
    public Target {
      if (!Double.isFinite(difficulty)
          || !Double.isFinite(minutes)
          || difficulty <= 0
          || min < 1
          || max < min
          || reward < 0
          || minutes <= 0) {
        throw new IllegalArgumentException(
            "a target needs a positive difficulty and minutes, 1 <= min <= max, reward >= 0");
      }
    }
  }
}
