package com.shepherdjerred.thestorm.quests.domain.content;

import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.model.Stage;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

/** The statechart checks: targets exist, every stage is reachable and can finish, no spins. */
final class Graph {

  private Graph() {}

  /** Every target a stage can lead to, including its time limit's. */
  static List<String> targets(Stage stage) {
    var targets = new ArrayList<>(stage.next().targets());
    stage.timeLimit().ifPresent(limit -> targets.add(limit.target()));
    return targets;
  }

  /** Problems with {@code quest}'s stage graph, as messages about paths under the quest. */
  static List<String> problems(Quest quest) {
    var problems = new ArrayList<String>();
    if (quest.stage(quest.start()).isEmpty()) {
      problems.add("start stage " + quest.start() + " does not exist");
      return problems;
    }
    for (var stage : sorted(quest)) {
      for (var target : targets(stage)) {
        if (!Stage.COMPLETE.equals(target)
            && !Stage.FAIL.equals(target)
            && quest.stage(target).isEmpty()) {
          problems.add("stage " + stage.id() + " leads to " + target + ", which does not exist");
        }
      }
    }
    if (!problems.isEmpty()) {
      return problems;
    }
    var reachable = reachable(quest);
    for (var stage : sorted(quest)) {
      if (!reachable.contains(stage.id())) {
        problems.add("stage " + stage.id() + " can never be reached from " + quest.start());
      } else if (!canComplete(quest, stage.id())) {
        problems.add("stage " + stage.id() + " can never lead to completion");
      }
    }
    spins(quest).forEach(problems::add);
    return problems;
  }

  private static Set<String> reachable(Quest quest) {
    var seen = new HashSet<String>();
    var queue = new ArrayDeque<String>();
    queue.add(quest.start());
    while (!queue.isEmpty()) {
      var id = queue.poll();
      var stage = quest.stage(id);
      if (stage.isEmpty() || !seen.add(id)) {
        continue;
      }
      queue.addAll(targets(stage.get()));
    }
    return seen;
  }

  private static boolean canComplete(Quest quest, String from) {
    var seen = new HashSet<String>();
    var queue = new ArrayDeque<String>();
    queue.add(from);
    while (!queue.isEmpty()) {
      var id = queue.poll();
      if (Stage.COMPLETE.equals(id)) {
        return true;
      }
      var stage = quest.stage(id);
      if (stage.isEmpty() || !seen.add(id)) {
        continue;
      }
      // Timing out is not a way to finish; only branches count.
      queue.addAll(stage.get().next().targets());
    }
    return false;
  }

  /**
   * Loops made only of stages with no objectives and guarded branches, which would pass instantly
   * forever.
   */
  private static List<String> spins(Quest quest) {
    var problems = new ArrayList<String>();
    for (var stage : sorted(quest)) {
      if (instant(stage) && returnsTo(quest, stage.id())) {
        problems.add(
            "stage "
                + stage.id()
                + " can loop back to itself through stages with no objectives; give one an"
                + " objective or a choice");
      }
    }
    return problems;
  }

  private static boolean returnsTo(Quest quest, String start) {
    var seen = new HashSet<String>();
    var queue = new ArrayDeque<>(quest.stage(start).orElseThrow().next().targets());
    while (!queue.isEmpty()) {
      var id = queue.poll();
      if (id.equals(start)) {
        return true;
      }
      var stage = quest.stage(id);
      if (stage.isPresent() && instant(stage.get()) && seen.add(id)) {
        queue.addAll(stage.get().next().targets());
      }
    }
    return false;
  }

  private static boolean instant(Stage stage) {
    return stage.objectives().isEmpty() && stage.next() instanceof Stage.Next.Guarded;
  }

  /**
   * The most crystals any run through {@code quest} can pay: accept actions, the richest simple
   * path of stage actions from the start to completion, and the rewards.
   */
  static long richestPath(Quest quest) {
    return crystals(quest.onAccept())
        + richestFrom(quest, quest.start(), new HashSet<>())
        + crystals(quest.rewards());
  }

  private static long richestFrom(Quest quest, String id, Set<String> path) {
    var stage = quest.stage(id);
    if (stage.isEmpty() || path.contains(id)) {
      return 0;
    }
    path.add(id);
    var best = 0L;
    for (var target : targets(stage.get())) {
      best = Math.max(best, richestFrom(quest, target, path));
    }
    path.remove(id);
    return crystals(stage.get().onComplete()) + best;
  }

  static long crystals(List<Action> actions) {
    return actions.stream()
        .mapToLong(action -> action instanceof Action.Crystals(var amount) ? amount : 0)
        .sum();
  }

  private static List<Stage> sorted(Quest quest) {
    var ids = new TreeSet<>(quest.stages().keySet());
    return ids.stream().map(id -> quest.stage(id).orElseThrow()).toList();
  }
}
