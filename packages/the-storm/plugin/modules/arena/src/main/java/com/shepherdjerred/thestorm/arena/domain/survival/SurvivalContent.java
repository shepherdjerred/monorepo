package com.shepherdjerred.thestorm.arena.domain.survival;

import com.shepherdjerred.thestorm.arena.domain.arena.ArenaDefinition;
import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.arena.domain.geometry.Point;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Strict, authored settlement content. Disabled placements are still validated at startup. */
public record SurvivalContent(
    boolean enabled, ArenaDefinition arena, int entityCap, List<Zone> zones, List<Recipe> recipes) {
  public enum StationType {
    WORKBENCH,
    FORGE,
    INFIRMARY,
    ALCHEMY
  }

  public enum DefenseType {
    BARRICADE,
    SPIKE_TRAP,
    FLAME_TRAP
  }

  public record Station(BlockPos block, StationType type) {}

  public record Resource(BlockPos block, String material, int amount, int perRound) {
    public Resource {
      if (amount < 1 || perRound < 1) {
        throw new IllegalArgumentException("Invalid resource budget");
      }
    }
  }

  public record Defense(String id, BlockPos block, DefenseType type) {}

  public record Zone(
      String id,
      String name,
      Cuboid bounds,
      int emeralds,
      Set<String> requires,
      Point entrance,
      List<BlockPos> gate,
      List<Station> stations,
      List<Resource> resources,
      List<Defense> defenses) {
    public Zone {
      requires = Set.copyOf(requires);
      gate = List.copyOf(gate);
      stations = List.copyOf(stations);
      resources = List.copyOf(resources);
      defenses = List.copyOf(defenses);
      if (emeralds < 0 || !bounds.contains(entrance)) {
        throw new IllegalArgumentException("Invalid zone " + id);
      }
    }
  }

  public record Recipe(
      String id,
      String name,
      StationType station,
      String material,
      int amount,
      Map<String, Integer> ingredients) {
    public Recipe {
      ingredients = Map.copyOf(ingredients);
      if (amount < 1
          || amount > 64
          || ingredients.isEmpty()
          || ingredients.values().stream().anyMatch(n -> n < 1)) {
        throw new IllegalArgumentException("Invalid recipe " + id);
      }
    }
  }

  public SurvivalContent {
    zones = List.copyOf(zones);
    recipes = List.copyOf(recipes);
    if (entityCap < 8 || entityCap > 40 || arena.maxPlayers() != 4) {
      throw new IllegalArgumentException("Survival needs four player slots and a cap of 8..40");
    }
    var ids = new HashSet<String>();
    zones.forEach(
        zone -> {
          if (!ids.add(zone.id())
              || !arena.region().contains(zone.bounds().min())
              || !arena.region().contains(zone.bounds().max())) {
            throw new IllegalArgumentException("Duplicate or misplaced zone " + zone.id());
          }
          fixtures(arena.region(), zone);
        });
    if (zones.size() != 8 || zones.stream().noneMatch(z -> z.emeralds() == 0)) {
      throw new IllegalArgumentException("Author eight zones including a starting zone");
    }
    validateRoutes(zones, ids);
    validateLayout(zones);
    var recipeIds = new HashSet<String>();
    for (var recipe : recipes) {
      if (!recipeIds.add(recipe.id())) {
        throw new IllegalArgumentException("Duplicate recipe");
      }
    }
  }

  private static void fixtures(Cuboid region, Zone zone) {
    var positions = new HashSet<BlockPos>();
    positions.addAll(zone.gate());
    zone.stations().forEach(s -> positions.add(s.block()));
    zone.resources().forEach(r -> positions.add(r.block()));
    zone.defenses().forEach(d -> positions.add(d.block()));
    var expected =
        zone.gate().size()
            + zone.stations().size()
            + zone.resources().size()
            + zone.defenses().size();
    if (positions.size() != expected
        || positions.stream().anyMatch(p -> !region.contains(p) || !zone.bounds().contains(p))) {
      throw new IllegalArgumentException("Fixture outside settlement: " + zone.id());
    }
  }

  private static void validateLayout(List<Zone> zones) {
    var defenses = new HashSet<String>();
    for (var zone : zones) {
      if (zone.stations().isEmpty() || zone.resources().isEmpty() || zone.gate().isEmpty()) {
        throw new IllegalArgumentException(
            "Zone needs stations, resources and routes: " + zone.id());
      }
      zone.defenses()
          .forEach(
              d -> {
                if (!defenses.add(d.id())) {
                  throw new IllegalArgumentException("Duplicate defense " + d.id());
                }
              });
    }
    for (var a = 0; a < zones.size(); a++) {
      for (var b = a + 1; b < zones.size(); b++) {
        var one = zones.get(a).bounds();
        var two = zones.get(b).bounds();
        if (Math.max(one.min().x(), two.min().x()) <= Math.min(one.max().x(), two.max().x())
            && Math.max(one.min().z(), two.min().z()) <= Math.min(one.max().z(), two.max().z())) {
          throw new IllegalArgumentException("District footprints overlap");
        }
      }
    }
  }

  private static void validateRoutes(List<Zone> zones, Set<String> ids) {
    var reached = new HashSet<String>();
    zones.stream().filter(z -> z.emeralds() == 0).map(Zone::id).forEach(reached::add);
    for (var pass = 0; pass < zones.size(); pass++) {
      for (var zone : zones) {
        if (!ids.containsAll(zone.requires()) || zone.requires().contains(zone.id())) {
          throw new IllegalArgumentException("Invalid route requirement: " + zone.id());
        }
        if (reached.containsAll(zone.requires())) {
          reached.add(zone.id());
        }
      }
    }
    if (!reached.containsAll(ids)) {
      throw new IllegalArgumentException("Settlement has unreachable zones");
    }
  }
}
