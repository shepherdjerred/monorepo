package com.shepherdjerred.thestorm.quests.domain.state;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * A quest a player has taken and not finished.
 *
 * @param quest the quest id
 * @param stage the current stage id
 * @param progress each objective's count in the current stage, in order
 * @param phase whether the stage is in progress, waiting for a branch or waiting for a choice
 * @param startedAt when the quest was accepted
 * @param stageStartedAt when the current stage began, for time limits
 */
public record ActiveQuest(
    String quest,
    String stage,
    List<Integer> progress,
    Phase phase,
    Instant startedAt,
    Instant stageStartedAt) {

  public ActiveQuest {
    progress = List.copyOf(progress);
    if (progress.stream().anyMatch(count -> count < 0)) {
      throw new IllegalArgumentException("objective progress cannot be negative");
    }
  }

  /**
   * A quest entering {@code stage} at {@code now}, with {@code objectives} counters at zero. It
   * counts as accepted now; see {@link #withStartedAt}.
   */
  public static ActiveQuest entering(String quest, String stage, int objectives, Instant now) {
    return new ActiveQuest(
        quest, stage, Collections.nCopies(objectives, 0), Phase.IN_PROGRESS, now, now);
  }

  /** This, accepted at {@code at}. */
  public ActiveQuest withStartedAt(Instant at) {
    return new ActiveQuest(quest, stage, progress, phase, at, stageStartedAt);
  }

  /** The count of objective {@code index}. */
  public int count(int index) {
    return progress.get(index);
  }

  /** This with objective {@code index} set to {@code count}. */
  public ActiveQuest withCount(int index, int count) {
    var next = new ArrayList<>(progress);
    next.set(index, count);
    return new ActiveQuest(quest, stage, next, phase, startedAt, stageStartedAt);
  }

  /** This in {@code next} phase. */
  public ActiveQuest withPhase(Phase next) {
    return new ActiveQuest(quest, stage, progress, next, startedAt, stageStartedAt);
  }

  /** Where the stage stands. */
  public enum Phase {
    /** Objectives are being worked on. */
    IN_PROGRESS,
    /** Objectives are done; no branch's conditions hold yet. */
    WAITING,
    /** Objectives are done; the player must choose at the giver. */
    CHOOSING
  }
}
