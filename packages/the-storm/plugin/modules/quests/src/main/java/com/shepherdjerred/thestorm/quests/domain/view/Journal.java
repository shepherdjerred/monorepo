package com.shepherdjerred.thestorm.quests.domain.view;

import com.shepherdjerred.thestorm.quests.domain.content.Collections;
import com.shepherdjerred.thestorm.quests.domain.engine.Catalog;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine;
import com.shepherdjerred.thestorm.quests.domain.model.Faction;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.state.ActiveQuest;
import com.shepherdjerred.thestorm.quests.domain.state.ActiveQuest.Phase;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** The quest journal and the tracking sidebar, as plain text. */
public final class Journal {

  /** The longest sidebar line. */
  public static final int SIDEBAR_WIDTH = 40;

  private Journal() {}

  /**
   * The journal.
   *
   * @param body the text: active quests with their objectives, then completions and standing
   * @param active the active quests, in the order listed, for Track buttons
   */
  public record View(String body, List<String> active) {}

  /**
   * The sidebar for the tracked quest.
   *
   * @param title the quest name
   * @param lines one line per objective, done ones marked
   */
  public record Sidebar(String title, List<String> lines) {}

  /** Additional authored content shown with persistent quest state. */
  public record Content(Map<String, Faction> factions, Collections collections) {}

  /** The journal for {@code state}. */
  public static View journal(
      PlayerQuests state, Catalog catalog, Describe.Lookup lookup, Content content) {
    var text = new StringBuilder();
    var active = new ArrayList<String>();
    if (state.active().isEmpty()) {
      text.append("You have no quests. Look for NPCs with a ! above their heads.\n");
    }
    for (var quest : state.active().values()) {
      var definition = catalog.require(quest.quest());
      active.add(definition.id());
      var tracked = state.tracked().filter(definition.id()::equals).isPresent();
      text.append(tracked ? "» " : "")
          .append(definition.name())
          .append('\n')
          .append(QuestEngine.stageOf(catalog, quest).journal())
          .append('\n');
      for (var line : objectives(quest, catalog, lookup)) {
        text.append("  ").append(line).append('\n');
      }
      if (quest.phase() == Phase.CHOOSING) {
        text.append("  Decide at ").append(lookup.npc().apply(definition.giver())).append('\n');
      }
      text.append('\n');
    }
    var completed = state.completions().keySet().stream().filter(catalog.quests()::containsKey);
    text.append("Completed: ")
        .append(completed.count())
        .append("   Quest points: ")
        .append(state.points())
        .append('\n');
    var completedQuests =
        state.completions().entrySet().stream()
            .filter(entry -> catalog.quests().containsKey(entry.getKey()))
            .sorted(
                Map.Entry
                    .<String, com.shepherdjerred.thestorm.quests.domain.state.Completion>
                        comparingByValue(
                            Comparator.comparing(
                                com.shepherdjerred.thestorm.quests.domain.state.Completion::last))
                    .reversed())
            .limit(10)
            .toList();
    if (!completedQuests.isEmpty()) {
      text.append("Diary (latest finished quests, UTC):\n");
      for (var entry : completedQuests) {
        var quest = catalog.require(entry.getKey());
        text.append("  ")
            .append(LocalDate.ofInstant(entry.getValue().last(), ZoneOffset.UTC))
            .append("  ")
            .append(quest.name())
            .append(" — ")
            .append(quest.text().summary())
            .append('\n');
      }
    }
    var collections = content.collections();
    if (!collections.entries().isEmpty()) {
      text.append("Collections: ")
          .append(
              state.discoveries().keySet().stream()
                  .filter(collections.entries()::containsKey)
                  .count())
          .append('/')
          .append(collections.entries().size())
          .append('\n');
      collections.entries().values().stream()
          .sorted(
              Comparator.comparing(Collections.Entry::region)
                  .thenComparing(Collections.Entry::name))
          .filter(entry -> state.discoveries().containsKey(entry.id()))
          .forEach(
              entry ->
                  text.append("  ")
                      .append(entry.region())
                      .append(" · ")
                      .append(entry.name())
                      .append(": ")
                      .append(entry.note())
                      .append('\n'));
    }
    state
        .reputation()
        .forEach(
            (id, value) -> {
              var faction = Optional.ofNullable(content.factions().get(id));
              text.append(faction.map(Faction::name).orElse(id))
                  .append(": ")
                  .append(value)
                  .append(
                      faction
                          .flatMap(found -> found.rank(value))
                          .map(rank -> " (" + rank.name() + ")")
                          .orElse(""))
                  .append('\n');
            });
    return new View(text.toString().strip(), active);
  }

  /** The sidebar for the tracked quest, if one is tracked and active. */
  public static Optional<Sidebar> sidebar(
      PlayerQuests state, Catalog catalog, Describe.Lookup lookup, int maxLines) {
    var tracked = state.tracked().flatMap(state::active);
    if (tracked.isEmpty()) {
      return Optional.empty();
    }
    var quest = catalog.require(tracked.get().quest());
    var lines = new ArrayList<String>();
    if (tracked.get().phase() == Phase.CHOOSING) {
      lines.add(Dialogues.clip("Decide at " + lookup.npc().apply(quest.giver()), SIDEBAR_WIDTH));
    }
    for (var line : objectives(tracked.get(), catalog, lookup)) {
      if (lines.size() < maxLines) {
        lines.add(Dialogues.clip(line, SIDEBAR_WIDTH));
      }
    }
    return Optional.of(new Sidebar(Dialogues.clip(quest.name(), SIDEBAR_WIDTH), lines));
  }

  /** "✔ Kill 10 Zombie" or "• Bring 32 Iron Ingot to Thomas 12/32" for each objective. */
  public static List<String> objectives(
      ActiveQuest active, Catalog catalog, Describe.Lookup lookup) {
    var stage = QuestEngine.stageOf(catalog, active);
    var lines = new ArrayList<String>();
    for (var index = 0; index < stage.objectives().size(); index++) {
      var objective = stage.objectives().get(index);
      var count = active.count(index);
      var done = count >= objective.required();
      var suffix =
          done || objective.required() == 1 ? "" : " " + count + "/" + objective.required();
      lines.add((done ? "✔ " : "• ") + Describe.objective(objective, lookup) + suffix);
    }
    return lines;
  }

  /** The quest name for {@code id}, or the id if it is not in the catalog any more. */
  public static String name(Catalog catalog, String id) {
    return catalog.quest(id).map(Quest::name).orElse(id);
  }
}
