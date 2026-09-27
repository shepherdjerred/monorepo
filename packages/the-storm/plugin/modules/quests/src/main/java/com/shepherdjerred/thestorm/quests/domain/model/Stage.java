package com.shepherdjerred.thestorm.quests.domain.model;

import java.time.Duration;
import java.util.List;
import java.util.Optional;

/**
 * One state of a quest's statechart. The stage is done when every objective is (a stage with none
 * is done as soon as it is entered); then {@code onComplete} runs and {@code next} picks where to
 * go.
 *
 * @param id the stage id, unique within its quest
 * @param journal what the journal says the player is doing
 * @param waiting what the stage's NPC says if talked to before the stage is done, or while the
 *     player chooses a branch
 * @param complete what the NPC says when the stage is done
 * @param objectives what to do
 * @param onComplete actions run when the stage is done
 * @param next where to go once done
 * @param timeLimit how long the stage may take, and where to go when time runs out
 */
public record Stage(
    String id,
    String journal,
    Optional<String> waiting,
    Optional<String> complete,
    List<Objective> objectives,
    List<Action> onComplete,
    Next next,
    Optional<TimeLimit> timeLimit) {

  /** The target that completes the quest. */
  public static final String COMPLETE = "complete";

  /** The target that fails the quest. */
  public static final String FAIL = "fail";

  public Stage {
    objectives = List.copyOf(objectives);
    onComplete = List.copyOf(onComplete);
  }

  /** Where a finished stage goes. */
  public sealed interface Next {

    /** Every target this can lead to. */
    List<String> targets();

    /** The first branch whose conditions all hold. If none holds the quest waits until one does. */
    record Guarded(List<Branch> branches) implements Next {
      public Guarded {
        branches = List.copyOf(branches);
        if (branches.isEmpty()) {
          throw new IllegalArgumentException("a stage needs somewhere to go");
        }
      }

      @Override
      public List<String> targets() {
        return branches.stream().map(Branch::target).toList();
      }
    }

    /** The player picks one option, at the quest giver. */
    record Choice(List<Option> options) implements Next {
      public Choice {
        options = List.copyOf(options);
        if (options.isEmpty()) {
          throw new IllegalArgumentException("a choice needs options");
        }
      }

      @Override
      public List<String> targets() {
        return options.stream().map(Option::target).toList();
      }
    }
  }

  /**
   * A guarded transition.
   *
   * @param target a stage id, {@link #COMPLETE} or {@link #FAIL}
   * @param when conditions that must all hold
   */
  public record Branch(String target, List<Condition> when) {
    public Branch {
      when = List.copyOf(when);
    }
  }

  /** A choice the player can make. */
  public record Option(String label, String target) {}

  /** A deadline: after {@code limit} in the stage the quest goes to {@code target}. */
  public record TimeLimit(Duration limit, String target) {
    public TimeLimit {
      if (limit.isNegative() || limit.isZero()) {
        throw new IllegalArgumentException("a time limit must be positive");
      }
    }
  }
}
