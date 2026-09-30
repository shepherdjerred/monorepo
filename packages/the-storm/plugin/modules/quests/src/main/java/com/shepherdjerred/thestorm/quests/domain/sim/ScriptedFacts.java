package com.shepherdjerred.thestorm.quests.domain.sim;

import com.shepherdjerred.thestorm.quests.domain.engine.Facts;
import com.shepherdjerred.thestorm.quests.domain.model.Condition.Weather;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * A scripted world for the simulator and tests: an inventory of item matches, track levels, a
 * clock, weather, the regions the player stands in and the permissions they hold. Mutable; {@link
 * #copy()} forks it for another branch.
 */
public final class ScriptedFacts implements Facts {

  private final Map<ItemMatch, Integer> inventory = new HashMap<>();
  private final Map<String, Integer> tracks = new HashMap<>();
  private final Set<String> regions = new HashSet<>();
  private final Set<String> permissions = new HashSet<>();
  private int minute = 12 * 60;
  private Weather weather = Weather.CLEAR;

  /** A copy that changes independently. */
  public ScriptedFacts copy() {
    var copy = new ScriptedFacts();
    copy.inventory.putAll(inventory);
    copy.tracks.putAll(tracks);
    copy.regions.addAll(regions);
    copy.permissions.addAll(permissions);
    copy.minute = minute;
    copy.weather = weather;
    return copy;
  }

  public ScriptedFacts give(ItemMatch item, int amount) {
    inventory.merge(item, amount, Integer::sum);
    return this;
  }

  /** Takes {@code amount} of whatever carried items satisfy {@code item}. */
  public ScriptedFacts take(ItemMatch item, int amount) {
    if (count(item) < amount) {
      throw new IllegalStateException("took more " + item.material() + " than carried");
    }
    var left = amount;
    for (var entry : inventory.entrySet()) {
      if (left > 0 && satisfies(entry.getKey(), item)) {
        var taken = Math.min(left, entry.getValue());
        entry.setValue(entry.getValue() - taken);
        left -= taken;
      }
    }
    return this;
  }

  public ScriptedFacts track(String track, int level) {
    tracks.put(track, level);
    return this;
  }

  public ScriptedFacts at(String region) {
    regions.add(region);
    return this;
  }

  public ScriptedFacts leave(String region) {
    regions.remove(region);
    return this;
  }

  public ScriptedFacts permit(String node) {
    permissions.add(node);
    return this;
  }

  public ScriptedFacts time(int minuteOfDay) {
    minute = minuteOfDay;
    return this;
  }

  public ScriptedFacts weather(Weather next) {
    weather = next;
    return this;
  }

  /**
   * Counts exactly-equal matches, plus any carried match whose material and components satisfy
   * {@code item}.
   */
  @Override
  public int count(ItemMatch item) {
    return inventory.entrySet().stream()
        .filter(entry -> satisfies(entry.getKey(), item))
        .mapToInt(Map.Entry::getValue)
        .sum();
  }

  private static boolean satisfies(ItemMatch carried, ItemMatch wanted) {
    return wanted.matches(Items.facts(carried));
  }

  @Override
  public int trackLevel(String track) {
    return tracks.getOrDefault(track, 0);
  }

  @Override
  public int minuteOfDay() {
    return minute;
  }

  @Override
  public Weather weather() {
    return weather;
  }

  @Override
  public boolean inRegion(String region) {
    return regions.contains(region);
  }

  @Override
  public boolean hasPermission(String node) {
    return permissions.contains(node);
  }
}
