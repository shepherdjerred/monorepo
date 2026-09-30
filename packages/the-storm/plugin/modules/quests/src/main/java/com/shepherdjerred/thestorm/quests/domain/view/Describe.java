package com.shepherdjerred.thestorm.quests.domain.view;

import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import java.util.function.UnaryOperator;

/** Plain-language descriptions of objectives, for the journal and sidebar. */
public final class Describe {

  private Describe() {}

  /**
   * How names are looked up.
   *
   * @param npc an NPC id to its display name
   * @param region a region id to its display name
   */
  public record Lookup(UnaryOperator<String> npc, UnaryOperator<String> region) {}

  /** What {@code objective} asks, such as "Deliver 32 Iron Ingot to Thomas". */
  public static String objective(Objective objective, Lookup lookup) {
    if (objective.label().isPresent()) {
      return objective.label().get();
    }
    return switch (objective) {
      case Objective.Talk(var npc, _) -> "Talk to " + lookup.npc().apply(npc);
      case Objective.Deliver(var npc, var item, var amount, _) ->
          "Bring " + amount + " " + item(item) + " to " + lookup.npc().apply(npc);
      case Objective.Hold(var item, var amount, _) -> "Carry " + amount + " " + item(item);
      case Objective.Collect(var item, var amount, _) -> "Collect " + amount + " " + item(item);
      case Objective.Craft(var item, var amount, _) -> "Craft " + amount + " " + item(item);
      case Objective.Fish(var item, var amount, _) ->
          "Catch " + amount + " " + item.map(Describe::item).orElse("fish");
      case Objective.Mine(var block, var amount, _) -> "Mine " + amount + " " + Names.pretty(block);
      case Objective.Place(var block, var amount, _) ->
          "Place " + amount + " " + Names.pretty(block);
      case Objective.Kill(var entity, var amount, _) ->
          "Kill " + amount + " " + Names.pretty(entity);
      case Objective.Reach(var region, _) -> "Reach " + lookup.region().apply(region);
      case Objective.Level(var track, var level, _) -> "Reach " + Names.pretty(track) + " " + level;
      case Objective.Custom(var hook, var amount, _) ->
          Names.pretty(hook.replace('-', '_')) + " x" + amount;
    };
  }

  /** "Iron Ingot", "Diamond Sword (Sharpness 5)", or the item's custom name. */
  public static String item(ItemMatch item) {
    if (item.name().isPresent()) {
      return item.name().get();
    }
    var base = Names.pretty(item.material());
    if (item.enchantments().isEmpty() && item.potion().isEmpty()) {
      return base;
    }
    var details = new StringBuilder();
    item.potion().ifPresent(potion -> details.append(Names.pretty(potion)));
    item.enchantments()
        .forEach(
            (key, level) -> {
              if (!details.isEmpty()) {
                details.append(", ");
              }
              details.append(Names.pretty(key)).append(' ').append(level);
            });
    return base + " (" + details + ")";
  }

  /** "12/32", or "done". */
  public static String progress(int count, int required) {
    return count >= required ? "done" : count + "/" + required;
  }
}
