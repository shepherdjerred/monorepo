package com.shepherdjerred.thestorm.companions.domain;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Bounded backward chaining through vanilla recipe dependencies, with exact ingredient accounting.
 */
public final class RecipePlanner {
  public enum Station {
    HAND,
    WORKBENCH,
    FURNACE
  }

  public record Recipe(
      String key, String output, int amount, Map<String, Integer> ingredients, Station station) {
    public Recipe {
      ingredients = Map.copyOf(ingredients);
      if (amount < 1
          || amount > 64
          || ingredients.isEmpty()
          || ingredients.values().stream().anyMatch(value -> value < 1 || value > 9))
        throw new IllegalArgumentException("invalid recipe");
    }
  }

  public sealed interface Step {
    record Gather(String material, int amount) implements Step {}

    record Craft(Recipe recipe, int repetitions) implements Step {}
  }

  private final Map<String, Recipe> recipes;
  private final Set<String> gatherable;

  public RecipePlanner(Map<String, Recipe> recipes, Set<String> gatherable) {
    this.recipes = Map.copyOf(recipes);
    this.gatherable = Set.copyOf(gatherable);
  }

  public Optional<List<Step>> plan(String material, int amount, Map<String, Integer> inventory) {
    if (amount < 1 || amount > 256)
      throw new IllegalArgumentException("requested amount must be 1..256");
    if (inventory.values().stream().anyMatch(value -> value < 0 || value > 2304))
      throw new IllegalArgumentException("inventory count is outside player storage limits");
    var state = new Planning(new HashMap<>(inventory));
    return require(material, amount, state)
        ? Optional.of(List.copyOf(state.steps))
        : Optional.empty();
  }

  private static final class Planning {
    final Map<String, Integer> stock;
    final Set<String> visiting = new HashSet<>();
    final List<Step> steps = new ArrayList<>();
    int expansions;

    Planning(Map<String, Integer> stock) {
      this.stock = stock;
    }
  }

  private boolean require(String material, int amount, Planning state) {
    if (++state.expansions > 256 || state.visiting.size() >= 16 || amount > 2304) return false;
    var held = state.stock.getOrDefault(material, 0);
    if (held >= amount) return true;
    if (gatherable.contains(material)) {
      state.steps.add(new Step.Gather(material, amount - held));
      state.stock.put(material, amount);
      return true;
    }
    var recipe = recipes.get(material);
    if (recipe == null || !state.visiting.add(material)) return false;
    var repetitions = Math.ceilDiv(amount - held, recipe.amount());
    for (var entry :
        recipe.ingredients().entrySet().stream().sorted(Map.Entry.comparingByKey()).toList()) {
      if (!require(entry.getKey(), entry.getValue() * repetitions, state)) return false;
      state.stock.merge(entry.getKey(), -entry.getValue() * repetitions, Integer::sum);
    }
    state.visiting.remove(material);
    state.steps.add(new Step.Craft(recipe, repetitions));
    state.stock.merge(material, recipe.amount() * repetitions, Integer::sum);
    return true;
  }
}
