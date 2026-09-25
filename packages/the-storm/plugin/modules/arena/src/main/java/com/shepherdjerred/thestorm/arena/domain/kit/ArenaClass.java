package com.shepherdjerred.thestorm.arena.domain.kit;

import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * A class a player picks in the lobby: the kit they fight with.
 *
 * @param name the display name, such as "Wolfmaster"
 * @param advanced advanced classes need the {@code thestorm.arena.class.<id>} permission, which
 *     quests grant; the rest are open to everyone. There are no paid classes.
 * @param items the kit, given when the class is picked and again when the game starts
 * @param upgrade given on every upgrade wave, to refill consumables
 * @param effects potion effect key (such as {@code speed}) to amplifier (0 is level I), lasting the
 *     whole game
 * @param wolves how many tamed wolves fight beside the player, 0 to 10
 */
public record ArenaClass(
    String name,
    boolean advanced,
    List<ItemSpec> items,
    List<ItemSpec> upgrade,
    Map<String, Integer> effects,
    int wolves) {

  private static final Pattern KEY = Pattern.compile("[a-z0-9_.-]+(:[a-z0-9_./-]+)?");
  private static final int MAX_WOLVES = 10;

  public ArenaClass {
    if (name.isBlank()) {
      throw new IllegalArgumentException("name must not be blank");
    }
    if (items.isEmpty()) {
      throw new IllegalArgumentException("a class needs at least one item");
    }
    requireOneItemPerSlot(items);
    for (var effect : effects.entrySet()) {
      if (!KEY.matcher(effect.getKey()).matches()) {
        throw new IllegalArgumentException("invalid effect key: " + effect.getKey());
      }
      if (effect.getValue() < 0 || effect.getValue() > 255) {
        throw new IllegalArgumentException("effect amplifier must be 0-255: " + effect.getKey());
      }
    }
    if (wolves < 0 || wolves > MAX_WOLVES) {
      throw new IllegalArgumentException("wolves must be 0-" + MAX_WOLVES + ": " + wolves);
    }
    items = List.copyOf(items);
    upgrade = List.copyOf(upgrade);
    effects = Map.copyOf(new TreeMap<>(effects));
  }

  private static void requireOneItemPerSlot(List<ItemSpec> items) {
    var used = EnumSet.noneOf(Slot.class);
    for (var item : items) {
      if (item.slot().isPresent() && !used.add(item.slot().orElseThrow())) {
        throw new IllegalArgumentException(
            "two items are equipped in " + item.slot().orElseThrow());
      }
    }
  }
}
