package com.shepherdjerred.thestorm.quests.adapter.paper;

import com.shepherdjerred.thestorm.npcs.app.NpcActions;
import com.shepherdjerred.thestorm.npcs.app.NpcDialogs;
import com.shepherdjerred.thestorm.quests.app.DialogueBridge;
import com.shepherdjerred.thestorm.quests.app.QuestService;
import com.shepherdjerred.thestorm.quests.domain.board.BoardQuests;
import com.shepherdjerred.thestorm.quests.domain.config.QuestsConfig;
import com.shepherdjerred.thestorm.quests.domain.content.QuestContent;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.model.Stage;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.TreeSet;

/**
 * Puts quests in NPCs' mouths: a dialogue provider that offers quest conversations before an NPC's
 * own, and the NPC actions quest buttons run. Also registers {@code quests.accept} and {@code
 * quests.turnin}, which authored NPC dialogue can use to accept the NPC's first offered quest or
 * hand in everything due there.
 */
final class NpcBridge {

  private NpcBridge() {}

  static void install(
      NpcDialogs dialogs, NpcActions actions, QuestService service, QuestsConfig config) {
    dialogs.register(
        (player, npc) ->
            service
                .dialogue(player.getUniqueId(), npc.id())
                .map(dialogue -> DialogueBridge.graph(npc.id(), dialogue)));
    actions.register(
        DialogueBridge.ACCEPT,
        (player, npc) -> service.acceptFirst(player.getUniqueId(), npc.id()));
    actions.register(
        DialogueBridge.TURN_IN,
        (player, npc) -> service.handIn(player.getUniqueId(), npc.id(), Optional.empty()));
    for (var quest : questIds(service.content(), config)) {
      actions.register(
          DialogueBridge.accept(quest),
          (player, npc) -> service.accept(player.getUniqueId(), quest, npc.id()));
      actions.register(
          DialogueBridge.turnIn(quest),
          (player, npc) -> service.handIn(player.getUniqueId(), npc.id(), Optional.of(quest)));
    }
    for (var quest : service.content().quests().values()) {
      for (var option = 0; option < choices(quest); option++) {
        var index = option;
        actions.register(
            DialogueBridge.choose(quest.id(), index),
            (player, npc) -> service.choose(player.getUniqueId(), quest.id(), index));
      }
    }
  }

  /** Every quest id a dialogue can name: the content's and every board slot. */
  static List<String> questIds(QuestContent content, QuestsConfig config) {
    var ids = new TreeSet<>(content.quests().keySet());
    for (var slot = 1; slot <= config.board().dailies(); slot++) {
      ids.add(BoardQuests.DAILY_PREFIX + slot);
    }
    for (var slot = 1; slot <= config.board().weeklies(); slot++) {
      ids.add(BoardQuests.WEEKLY_PREFIX + slot);
    }
    return new ArrayList<>(ids);
  }

  private static int choices(Quest quest) {
    return quest.stages().values().stream()
        .mapToInt(
            stage -> stage.next() instanceof Stage.Next.Choice choice ? choice.options().size() : 0)
        .max()
        .orElse(0);
  }
}
