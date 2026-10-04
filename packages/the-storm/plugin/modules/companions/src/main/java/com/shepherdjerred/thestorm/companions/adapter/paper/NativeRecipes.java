package com.shepherdjerred.thestorm.companions.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.companions.domain.RecipePlanner;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.CraftItemEvent;
import org.bukkit.event.inventory.InventoryAction;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.inventory.CraftingInventory;
import org.bukkit.inventory.FurnaceRecipe;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.MenuType;
import org.bukkit.inventory.Recipe;
import org.bukkit.inventory.RecipeChoice;
import org.bukkit.inventory.ShapedRecipe;
import org.bukkit.inventory.ShapelessRecipe;
import org.jspecify.annotations.Nullable;

/** Uses the server recipe registry and its crafting events; no recipes or products are invented. */
public final class NativeRecipes {
  public record Selected(RecipePlanner.Recipe plan, Recipe nativeRecipe, List<Material> matrix) {}

  private final List<Recipe> catalog;

  public NativeRecipes() {
    var recipes = new ArrayList<Recipe>();
    Bukkit.recipeIterator().forEachRemaining(recipes::add);
    catalog = List.copyOf(recipes);
  }

  public Map<String, Selected> select(Map<String, Integer> stock) {
    var result = new LinkedHashMap<String, Selected>();
    for (var recipe : catalog) {
      var selected = describe(recipe, stock);
      if (selected.isEmpty()) continue;
      var candidate = selected.get();
      var key = candidate.plan().output();
      var existing = result.get(key);
      if (existing == null || cost(candidate, stock) < cost(existing, stock))
        result.put(key, candidate);
    }
    return Map.copyOf(result);
  }

  private static int cost(Selected recipe, Map<String, Integer> stock) {
    return recipe.plan().ingredients().entrySet().stream()
        .mapToInt(
            entry ->
                stock.getOrDefault(entry.getKey(), 0) >= entry.getValue() ? 0 : entry.getValue())
        .sum();
  }

  private static Optional<Selected> describe(Recipe recipe, Map<String, Integer> stock) {
    if (!(recipe instanceof ShapedRecipe
        || recipe instanceof ShapelessRecipe
        || recipe instanceof FurnaceRecipe)) return Optional.empty();
    var matrix = matrix(recipe, stock);
    if (matrix.isEmpty()) return Optional.empty();
    var ingredients = new HashMap<String, Integer>();
    matrix.get().stream()
        .filter(material -> !material.isAir())
        .forEach(material -> ingredients.merge(material.name(), 1, Integer::sum));
    if (ingredients.isEmpty()) return Optional.empty();
    var key = ((org.bukkit.Keyed) recipe).getKey();
    var output = recipe.getResult();
    return Optional.of(
        new Selected(
            new RecipePlanner.Recipe(
                key.toString(),
                output.getType().name(),
                output.getAmount(),
                ingredients,
                station(recipe)),
            recipe,
            matrix.get()));
  }

  private static RecipePlanner.Station station(Recipe recipe) {
    if (recipe instanceof FurnaceRecipe) return RecipePlanner.Station.FURNACE;
    if (recipe instanceof ShapelessRecipe shapeless)
      return shapeless.getChoiceList().size() <= 4
          ? RecipePlanner.Station.HAND
          : RecipePlanner.Station.WORKBENCH;
    if (recipe instanceof ShapedRecipe shaped)
      return shaped.getShape().length <= 2
              && Arrays.stream(shaped.getShape()).allMatch(row -> row.length() <= 2)
          ? RecipePlanner.Station.HAND
          : RecipePlanner.Station.WORKBENCH;
    throw new IllegalArgumentException("unsupported recipe station");
  }

  private static Optional<List<Material>> matrix(Recipe recipe, Map<String, Integer> stock) {
    var result = new ArrayList<>(java.util.Collections.nCopies(9, Material.AIR));
    if (recipe instanceof ShapedRecipe shaped) return shapedMatrix(shaped, stock, result);
    var choices =
        recipe instanceof ShapelessRecipe shapeless
            ? shapeless.getChoiceList()
            : recipe instanceof FurnaceRecipe furnace
                ? List.of(furnace.getInputChoice())
                : List.<RecipeChoice>of();
    for (var index = 0; index < choices.size(); index++) {
      var chosen = ingredient(choices.get(index), stock);
      if (chosen.isEmpty()) return Optional.empty();
      result.set(choices.size() <= 4 ? index / 2 * 3 + index % 2 : index, chosen.get());
    }
    return Optional.of(List.copyOf(result));
  }

  private static Optional<List<Material>> shapedMatrix(
      ShapedRecipe recipe, Map<String, Integer> stock, List<Material> result) {
    var shape = recipe.getShape();
    var choices = recipe.getChoiceMap();
    for (var index = 0; index < 9; index++) {
      var y = index / 3;
      var x = index % 3;
      if (y >= shape.length || x >= shape[y].length()) continue;
      var choice = choices.get(shape[y].charAt(x));
      if (choice == null) continue;
      var chosen = ingredient(choice, stock);
      if (chosen.isEmpty()) return Optional.empty();
      result.set(index, chosen.get());
    }
    return Optional.of(List.copyOf(result));
  }

  private static Optional<Material> ingredient(RecipeChoice choice, Map<String, Integer> stock) {
    if (!(choice instanceof RecipeChoice.MaterialChoice materials)) return Optional.empty();
    return materials.getChoices().stream()
        .min(Comparator.comparingInt(material -> preference(material, stock)));
  }

  private static int preference(Material material, Map<String, Integer> stock) {
    if (stock.getOrDefault(material.name(), 0) > 0) return 0;
    if (material.name().endsWith("_PLANKS")
        && stock.getOrDefault(material.name().replace("_PLANKS", "_LOG"), 0) > 0) return 1;
    return material.name().startsWith("OAK_") ? 2 : 3;
  }

  public static Map<String, Integer> stock(Player player) {
    var counts = new HashMap<String, Integer>();
    for (var item : requireNonNull(player.getInventory().getStorageContents())) {
      if (item != null && !item.getType().isAir())
        counts.merge(item.getType().name(), item.getAmount(), Integer::sum);
    }
    return Map.copyOf(counts);
  }

  public boolean craft(Player player, Selected selected, Optional<org.bukkit.Location> workbench) {
    if (selected.plan().station() == RecipePlanner.Station.FURNACE)
      throw new IllegalArgumentException("furnaces must cook in the world");
    var before = stock(player);
    if (selected.plan().ingredients().entrySet().stream()
        .anyMatch(entry -> before.getOrDefault(entry.getKey(), 0) < entry.getValue())) return false;
    var matrix =
        selected.matrix().stream()
            .map(material -> new ItemStack(material))
            .toArray(ItemStack[]::new);
    var result = Bukkit.craftItemResult(matrix, player.getWorld(), player);
    if (result.getResult().getType() != selected.nativeRecipe().getResult().getType()
        || result.getResult().isEmpty()) return false;
    var here = requireNonNull(player.getLocation());
    if (selected.plan().station() == RecipePlanner.Station.WORKBENCH
        && (workbench.isEmpty()
            || workbench.get().getBlock().getType() != Material.CRAFTING_TABLE
            || workbench.get().distanceSquared(here) > 16)) return false;
    var view =
        MenuType.CRAFTING
            .builder()
            .location(workbench.orElse(here))
            .checkReachable(workbench.isPresent())
            .build(player);
    if (!(view.getTopInventory() instanceof CraftingInventory grid))
      throw new IllegalStateException("workbench inventory is not a crafting grid");
    grid.setMatrix(matrix);
    grid.setResult(result.getResult());
    player.openInventory(view);
    try {
      var event =
          new CraftItemEvent(
              selected.nativeRecipe(),
              view,
              InventoryType.SlotType.RESULT,
              0,
              ClickType.LEFT,
              InventoryAction.PICKUP_ALL);
      Bukkit.getPluginManager().callEvent(event);
      if (event.isCancelled()) return false;
      if (!sameMatrix(matrix, requireNonNull(grid.getMatrix()))) return false;
      var produced = grid.getResult();
      if (produced == null || produced.isEmpty()) return false;
      return transfer(player, selected, produced, result);
    } finally {
      grid.clear();
      player.closeInventory();
    }
  }

  private static boolean sameMatrix(ItemStack[] expected, @Nullable ItemStack[] actual) {
    if (expected.length != actual.length) return false;
    for (var index = 0; index < expected.length; index++) {
      var left = expected[index];
      var right = actual[index];
      if (left.isEmpty()) {
        if (right != null && !right.isEmpty()) return false;
      } else if (!left.equals(right)) return false;
    }
    return true;
  }

  private static boolean transfer(
      Player player,
      Selected selected,
      ItemStack produced,
      org.bukkit.inventory.ItemCraftResult result) {
    var outputs = new ArrayList<ItemStack>();
    outputs.add(produced.clone());
    outputs.addAll(result.getOverflowItems());
    for (var remainder : result.getResultingMatrix())
      if (remainder != null && !remainder.isEmpty()) outputs.add(remainder.clone());
    var simulated = Bukkit.createInventory(null, 36);
    simulated.setContents(copies(player.getInventory()));
    if (!consume(simulated, selected.plan().ingredients())
        || !simulated.addItem(outputs.toArray(ItemStack[]::new)).isEmpty()) return false;
    if (!consume(player.getInventory(), selected.plan().ingredients()))
      throw new IllegalStateException("craft ingredients changed on the main thread");
    if (!player.getInventory().addItem(outputs.toArray(ItemStack[]::new)).isEmpty())
      throw new IllegalStateException("craft capacity changed on the main thread");
    return true;
  }

  private static ItemStack[] copies(Inventory inventory) {
    return Arrays.stream(requireNonNull(inventory.getStorageContents()))
        .map(item -> item == null ? new ItemStack(Material.AIR) : item.clone())
        .toArray(ItemStack[]::new);
  }

  private static boolean consume(Inventory inventory, Map<String, Integer> ingredients) {
    var contents = copies(inventory);
    var remaining = new HashMap<>(ingredients);
    for (var item : contents) {
      if (item == null || item.isEmpty()) continue;
      var amount = remaining.getOrDefault(item.getType().name(), 0);
      var used = Math.min(amount, item.getAmount());
      if (used > 0) {
        item.subtract(used);
        remaining.put(item.getType().name(), amount - used);
      }
    }
    if (remaining.values().stream().anyMatch(value -> value > 0)) return false;
    inventory.setStorageContents(contents);
    return true;
  }
}
