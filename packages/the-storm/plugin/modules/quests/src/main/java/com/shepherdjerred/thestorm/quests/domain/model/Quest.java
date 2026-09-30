package com.shepherdjerred.thestorm.quests.domain.model;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * A quest: who gives it, who may take it, how often, and its statechart of stages.
 *
 * @param id a stable lowercase id
 * @param name the display name
 * @param giver the NPC who offers it and hears choices
 * @param category what kind of quest it is
 * @param repeat how often it can be done
 * @param estimatedMinutes how long it takes a typical player, for the reward budget
 * @param requirements conditions that must all hold to be offered it
 * @param text what the giver says around it
 * @param start the first stage
 * @param stages every stage by id
 * @param onAccept actions run when the quest is accepted
 * @param rewards actions run when the quest completes
 */
public record Quest(
    String id,
    String name,
    String giver,
    Category category,
    Repeat repeat,
    int estimatedMinutes,
    List<Condition> requirements,
    QuestText text,
    String start,
    Map<String, Stage> stages,
    List<Action> onAccept,
    List<Action> rewards) {

  public Quest {
    requirements = List.copyOf(requirements);
    stages = Map.copyOf(stages);
    onAccept = List.copyOf(onAccept);
    rewards = List.copyOf(rewards);
    if (estimatedMinutes < 1) {
      throw new IllegalArgumentException("a quest takes at least a minute");
    }
  }

  /** The stage with {@code id}, if it exists. */
  public Optional<Stage> stage(String id) {
    return Optional.ofNullable(stages.get(id));
  }

  /** What a quest is, for the journal and markers. */
  public enum Category {
    /** The main story. */
    STORY,
    /** Side quests from townsfolk. */
    SIDE,
    /** Board quests that last a day. */
    DAILY,
    /** Board quests that last a week. */
    WEEKLY,
    /** A track's questline. */
    TRACK,
    /** Not advertised: no marker, and not listed until started. */
    HIDDEN
  }

  /**
   * How often a quest can be done. Days and weeks follow the configured time zone; a daily quest
   * becomes available again at the next local midnight, a weekly one at the start of the next week.
   */
  public enum Repeat {
    ONCE,
    DAILY,
    WEEKLY
  }

  /**
   * What the giver says.
   *
   * @param offer the offer, shown with Accept and Decline
   * @param accept the giver's reply to Accept
   * @param decline the giver's reply to Decline
   * @param finish what the giver says when the quest completes
   * @param summary one line for the journal
   * @param questions optional questions the player can ask before accepting
   */
  public record QuestText(
      String offer,
      String accept,
      String decline,
      String finish,
      String summary,
      List<Question> questions) {

    public QuestText {
      questions = List.copyOf(questions);
    }
  }

  /** A question the player can ask about a quest, and the giver's answer. */
  public record Question(String label, String answer) {}
}
