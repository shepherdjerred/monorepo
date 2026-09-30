package com.shepherdjerred.thestorm.quests.app;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.quests.domain.content.QuestContent;
import com.shepherdjerred.thestorm.quests.domain.engine.Catalog;
import com.shepherdjerred.thestorm.quests.domain.engine.Effect;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Faction;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.view.Describe;
import com.shepherdjerred.thestorm.quests.domain.view.Journal;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;

/** How quest effects read in chat and above the hotbar, in the house style. */
final class Notices {

  static final String LABEL = "Quests";

  private final QuestContent content;
  private final Describe.Lookup lookup;

  Notices(QuestContent content, Describe.Lookup lookup) {
    this.content = content;
    this.lookup = lookup;
  }

  /** The chat line for {@code effect}, if it has one. */
  Optional<Component> chat(Effect effect, Catalog catalog) {
    return switch (effect) {
      case Effect.Say(var npc, var text) ->
          Optional.of(HouseStyle.info(lookup.npc().apply(npc), Component.text(text)));
      case Effect.Accepted(var quest) ->
          Optional.of(success("Quest accepted: ", Journal.name(catalog, quest)));
      case Effect.StageStarted(var quest, var stage) ->
          catalog
              .quest(quest)
              .flatMap(found -> found.stage(stage))
              .map(found -> HouseStyle.info(LABEL, Component.text(found.journal())));
      case Effect.ChoiceNeeded(var quest) ->
          catalog
              .quest(quest)
              .map(Quest::giver)
              .map(
                  giver ->
                      HouseStyle.info(
                          LABEL,
                          Component.text(
                              "Return to " + lookup.npc().apply(giver) + " to decide.")));
      case Effect.Completed(var quest) ->
          Optional.of(success("Quest complete: ", Journal.name(catalog, quest)));
      case Effect.Failed(var quest) ->
          Optional.of(
              HouseStyle.error(
                  LABEL, Component.text("Quest failed: " + Journal.name(catalog, quest))));
      case Effect.Abandoned(var quest) ->
          Optional.of(
              HouseStyle.info(
                  LABEL, Component.text("Quest dropped: " + Journal.name(catalog, quest))));
      case Effect.ReputationChanged(var faction, var delta, var total) ->
          Optional.of(
              HouseStyle.info(
                  LABEL,
                  Component.text(
                      (delta >= 0 ? "+" : "")
                          + delta
                          + " reputation with "
                          + content.faction(faction).map(Faction::name).orElse(faction)
                          + " ("
                          + total
                          + ")")));
      case Effect.PointsGained(var amount, var total) ->
          Optional.of(
              HouseStyle.info(
                  LABEL,
                  Component.text(
                      "+"
                          + amount
                          + " quest point"
                          + (amount == 1 ? "" : "s")
                          + " ("
                          + total
                          + ")")));
      case Effect.Discovered(var name) -> Optional.of(success("Collection discovered: ", name));
      case Effect.World(_, Action.Take(var item, var amount)) ->
          Optional.of(
              HouseStyle.info(
                  LABEL,
                  Component.text("Handed over " + amount + " " + Describe.item(item) + ".")));
      case Effect.World _, Effect.Progressed _ -> Optional.empty();
    };
  }

  /** The hotbar line for an objective's progress. */
  Optional<Component> actionBar(Effect effect, Catalog catalog) {
    if (!(effect
        instanceof
        Effect.Progressed(var quest, var stageId, var objective, var count, var required))) {
      return Optional.empty();
    }
    return catalog
        .quest(quest)
        .flatMap(found -> found.stage(stageId))
        .filter(stage -> stage.objectives().size() > objective)
        .map(
            stage ->
                Component.text(
                    Describe.objective(stage.objectives().get(objective), lookup)
                        + "  "
                        + Describe.progress(count, required),
                    count >= required ? NamedTextColor.GREEN : NamedTextColor.GRAY));
  }

  static Component info(String message) {
    return HouseStyle.info(LABEL, Component.text(message));
  }

  static Component error(String message) {
    return HouseStyle.error(LABEL, Component.text(message));
  }

  static Component success(String message) {
    return HouseStyle.success(LABEL, Component.text(message));
  }

  private static Component success(String prefix, String name) {
    return HouseStyle.success(LABEL, Component.text(prefix + name));
  }
}
