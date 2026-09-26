package com.shepherdjerred.thestorm.quests.domain.view;

import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine.Availability;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine.Context;
import com.shepherdjerred.thestorm.quests.domain.model.Action.NpcMark;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.model.Stage;
import com.shepherdjerred.thestorm.quests.domain.state.ActiveQuest;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * The quest markers a player should see: {@code ?} where they can hand in or report right now, or
 * must choose; {@code !} where a quest is offered to them (hidden quests excepted); otherwise any
 * marker a quest pinned; otherwise none.
 */
public final class Markers {

  private Markers() {}

  /** Every NPC quests could mark: givers, hand-in NPCs and pinned markers. */
  public static Set<String> npcs(PlayerQuests state, Context context) {
    var npcs = new TreeSet<String>(state.marks().keySet());
    for (var quest : context.catalog().all()) {
      npcs.add(quest.giver());
      for (var stage : quest.stages().values()) {
        for (var objective : stage.objectives()) {
          if (objective instanceof Objective.Talk(var npc, _)) {
            npcs.add(npc);
          } else if (objective instanceof Objective.Deliver(var npc, _, _, _)) {
            npcs.add(npc);
          }
        }
      }
    }
    return npcs;
  }

  /** The marker for each of {@code npcs}. */
  public static Map<String, NpcMark> compute(
      PlayerQuests state, Context context, Set<String> npcs) {
    var marks = new TreeMap<String, NpcMark>();
    for (var npc : npcs) {
      marks.put(npc, mark(state, context, npc));
    }
    return marks;
  }

  private static NpcMark mark(PlayerQuests state, Context context, String npc) {
    for (var active : state.active().values()) {
      if (ready(active, context, npc)) {
        return NpcMark.TURN_IN;
      }
    }
    var offered =
        context.catalog().all().stream()
            .filter(quest -> quest.giver().equals(npc))
            .filter(quest -> quest.category() != Quest.Category.HIDDEN)
            .anyMatch(
                quest -> QuestEngine.availability(state, quest, context) == Availability.OFFERABLE);
    if (offered) {
      return NpcMark.AVAILABLE;
    }
    return state.marks().getOrDefault(npc, NpcMark.NONE);
  }

  private static boolean ready(ActiveQuest active, Context context, String npc) {
    var quest = context.catalog().require(active.quest());
    var stage = QuestEngine.stageOf(context.catalog(), active);
    return switch (active.phase()) {
      case CHOOSING -> quest.giver().equals(npc);
      case WAITING -> false;
      case IN_PROGRESS -> canHandIn(stage, active, context, npc);
    };
  }

  private static boolean canHandIn(Stage stage, ActiveQuest active, Context context, String npc) {
    for (var index = 0; index < stage.objectives().size(); index++) {
      var objective = stage.objectives().get(index);
      var remaining = objective.required() - active.count(index);
      if (remaining <= 0) {
        continue;
      }
      if (objective instanceof Objective.Deliver deliver
          && deliver.npc().equals(npc)
          && context.facts().count(deliver.item()) >= remaining) {
        return true;
      }
      if (objective instanceof Objective.Talk talk
          && talk.npc().equals(npc)
          && QuestEngine.reportsAt(stage, active, npc)) {
        return true;
      }
    }
    return false;
  }
}
