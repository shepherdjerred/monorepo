package com.shepherdjerred.thestorm.quests.adapter.content;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentRules;
import com.shepherdjerred.thestorm.quests.adapter.paper.Registries;
import com.shepherdjerred.thestorm.quests.domain.config.QuestsConfig;
import com.shepherdjerred.thestorm.quests.domain.content.ContentCheck;
import com.shepherdjerred.thestorm.quests.domain.content.ContentRegistry;
import com.shepherdjerred.thestorm.quests.domain.content.QuestContent;
import java.nio.file.Path;
import java.util.Set;

/**
 * The content the repository ships, loaded as the server would: NPC ids from the shipped NPC
 * content and materials, entities, enchantments and potions from Paper's registries. Needs a
 * running MockBukkit server for the registries.
 */
final class ShippedContent {

  static final Path OWNED = Path.of("../../../server/owned/plugins/TheStorm");
  static final String OVERWORLD = "minecraft:overworld";

  private ShippedContent() {}

  static QuestsConfig config() {
    return ConfigFiles.load(OWNED.resolve("quests.yml"), QuestsConfig.class);
  }

  static Set<String> npcs() {
    var rules = new ContentRules(Set.of(OVERWORLD), Registries.tracks());
    return com.shepherdjerred.thestorm.npcs.adapter.content.ContentLoader.load(OWNED, rules)
        .fold(
            content -> content.npcs().keySet(),
            problems -> {
              throw new AssertionError("NPC content is invalid: " + problems);
            });
  }

  static ContentRegistry registry() {
    return new ContentRegistry(
        npcs(),
        Registries.materials(true),
        Registries.materials(false),
        Registries.entities(),
        Set.of(OVERWORLD),
        Registries.tracks(),
        Registries.enchantments(),
        Registries.potions());
  }

  static ContentCheck.Rules rules() {
    var config = config();
    return new ContentCheck.Rules(registry(), config.budget(), config.board().npc(), OVERWORLD);
  }

  static QuestContent load() {
    return ContentLoader.load(OWNED, rules())
        .fold(
            content -> content,
            problems -> {
              throw new AssertionError(
                  "shipped quest content is invalid:\n"
                      + String.join("\n", problems.stream().map(Object::toString).toList()));
            });
  }
}
