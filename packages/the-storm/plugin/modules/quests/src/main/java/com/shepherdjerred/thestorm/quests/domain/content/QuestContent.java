package com.shepherdjerred.thestorm.quests.domain.content;

import com.shepherdjerred.thestorm.quests.domain.board.Template;
import com.shepherdjerred.thestorm.quests.domain.engine.Catalog;
import com.shepherdjerred.thestorm.quests.domain.model.Faction;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.model.Region;
import java.util.Map;
import java.util.Optional;

/**
 * All quest content, compiled. Validity against the server (NPCs, materials, worlds...) and the
 * statechart checks are {@link ContentCheck}'s job.
 *
 * @param quests authored quests by id
 * @param factions factions by id
 * @param variables declared variables and what they mean
 * @param regions regions by id
 * @param hooks declared custom hooks and what they do
 * @param templates board templates by id
 * @param sources the file each quest and template came from, for problem reports
 */
public record QuestContent(
    Map<String, Quest> quests,
    Map<String, Faction> factions,
    Map<String, String> variables,
    Map<String, Region> regions,
    Map<String, String> hooks,
    Map<String, Template> templates,
    Map<String, String> sources) {

  public QuestContent {
    quests = Map.copyOf(quests);
    factions = Map.copyOf(factions);
    variables = Map.copyOf(variables);
    regions = Map.copyOf(regions);
    hooks = Map.copyOf(hooks);
    templates = Map.copyOf(templates);
    sources = Map.copyOf(sources);
  }

  /** No content at all. */
  public static QuestContent empty() {
    return new QuestContent(Map.of(), Map.of(), Map.of(), Map.of(), Map.of(), Map.of(), Map.of());
  }

  /** The authored quests as a catalog. */
  public Catalog catalog() {
    return new Catalog(quests);
  }

  public Optional<Region> region(String id) {
    return Optional.ofNullable(regions.get(id));
  }

  public Optional<Faction> faction(String id) {
    return Optional.ofNullable(factions.get(id));
  }

  public Optional<Template> template(String id) {
    return Optional.ofNullable(templates.get(id));
  }

  /** The file {@code id} (a quest or template) came from. */
  public String source(String id) {
    return sources.getOrDefault(id, "quests");
  }
}
