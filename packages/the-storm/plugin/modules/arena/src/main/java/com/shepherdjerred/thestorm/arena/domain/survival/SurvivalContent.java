package com.shepherdjerred.thestorm.arena.domain.survival;

import com.shepherdjerred.thestorm.arena.domain.arena.ArenaDefinition;
import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.arena.domain.geometry.Point;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Explicit authored areas and fixtures; every placement is validated before player admission. */
public record SurvivalContent(
    boolean enabled,
    ArenaDefinition arena,
    int entityCap,
    List<Zone> zones,
    List<Recipe> recipes,
    Cuboid lobbyArea,
    Expedition expedition,
    List<Machine> machines,
    List<PlanePart> planeParts,
    BlockPos planeWorkbench,
    BlockPos bossObjective) {
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

  public enum MachineType {
    FOOD,
    POWER,
    MYSTERY_BOX,
    JUGGERNOG,
    STAMIN_UP,
    DOUBLE_TAP,
    QUICK_REVIVE,
    PACK_A_PUNCH
  }

  public record Station(BlockPos block, StationType type) {}

  public record Machine(BlockPos block, MachineType type) {}

  public record PlanePart(String id, String name, BlockPos block) {}

  public record Expedition(
      Cuboid area,
      Point arrival,
      Point returnTo,
      BlockPos returnSign,
      List<Point> spawns,
      List<Point> safePoints) {
    public Expedition {
      spawns = List.copyOf(spawns);
      safePoints = List.copyOf(safePoints);
      if (spawns.isEmpty()
          || safePoints.isEmpty()
          || !area.contains(arrival)
          || !area.contains(returnSign)
          || spawns.stream().anyMatch(p -> !area.contains(p))
          || safePoints.stream().anyMatch(p -> !area.contains(p)))
        throw new IllegalArgumentException("Invalid expedition");
    }
  }

  public record Resource(BlockPos block, String material, int amount, int perRound) {
    public Resource {
      if (amount < 1 || perRound < 1) throw new IllegalArgumentException("Invalid resource budget");
    }
  }

  public record Defense(String id, BlockPos block, DefenseType type) {}

  public record Zone(
      String id,
      String name,
      List<Cuboid> areas,
      int emeralds,
      Set<String> requires,
      Point entrance,
      List<Point> spawns,
      List<Point> safePoints,
      List<BlockPos> purchaseSigns,
      List<BlockPos> gate,
      List<Station> stations,
      List<Resource> resources,
      List<Defense> defenses) {
    public Zone {
      areas = List.copyOf(areas);
      requires = Set.copyOf(requires);
      spawns = List.copyOf(spawns);
      safePoints = List.copyOf(safePoints);
      purchaseSigns = List.copyOf(purchaseSigns);
      gate = List.copyOf(gate);
      stations = List.copyOf(stations);
      resources = List.copyOf(resources);
      defenses = List.copyOf(defenses);
      if (emeralds < 0
          || areas.isEmpty()
          || spawns.isEmpty()
          || safePoints.isEmpty()
          || purchaseSigns.isEmpty()
          || areas.stream().noneMatch(a -> a.contains(entrance)))
        throw new IllegalArgumentException("Invalid zone " + id);
    }

    public boolean contains(Point point) {
      return areas.stream().anyMatch(a -> a.contains(point));
    }

    public boolean contains(BlockPos point) {
      return areas.stream().anyMatch(a -> a.contains(point));
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
          || ingredients.values().stream().anyMatch(n -> n < 1))
        throw new IllegalArgumentException("Invalid recipe " + id);
    }
  }

  public SurvivalContent {
    zones = List.copyOf(zones);
    recipes = List.copyOf(recipes);
    machines = List.copyOf(machines);
    planeParts = List.copyOf(planeParts);
    if (entityCap < 8 || entityCap > 40 || arena.maxPlayers() != 4 || zones.size() != 8)
      throw new IllegalArgumentException(
          "Survival needs eight districts, four slots and an entity cap of 8..40");
    var ids = new HashSet<String>();
    var fixtures = new HashSet<BlockPos>();
    for (var zone : zones) {
      if (!ids.add(zone.id())) throw new IllegalArgumentException("Duplicate zone " + zone.id());
      zone.areas().forEach(a -> inside(arena.region(), a));
      if (zone.stations().isEmpty() || zone.resources().isEmpty() || zone.gate().isEmpty())
        throw new IllegalArgumentException(
            "District needs stations, resources and gates: " + zone.id());
      zone.spawns()
          .forEach(
              p -> {
                if (!zone.contains(p)) throw new IllegalArgumentException("Misplaced spawn");
              });
      zone.safePoints()
          .forEach(
              p -> {
                if (!zone.contains(p)) throw new IllegalArgumentException("Misplaced safe point");
              });
      zone.purchaseSigns().forEach(p -> add(fixtures, arena.region(), p));
      zone.gate()
          .forEach(
              p -> {
                if (!arena.region().contains(p))
                  throw new IllegalArgumentException("Misplaced gate");
              });
      zone.stations().forEach(s -> add(fixtures, arena.region(), s.block()));
      zone.resources().forEach(r -> add(fixtures, arena.region(), r.block()));
      zone.defenses().forEach(d -> add(fixtures, arena.region(), d.block()));
    }
    inside(arena.region(), lobbyArea);
    inside(arena.region(), expedition.area());
    if (!lobbyArea.contains(arena.lobby().point())
        || !arena.region().contains(expedition.returnTo()))
      throw new IllegalArgumentException("Misplaced lobby or return");
    for (var zone : zones) {
      for (var area : zone.areas()) {
        if (overlaps(area, lobbyArea) || overlaps(area, expedition.area()))
          throw new IllegalArgumentException("Staging overlaps combat");
      }
    }
    for (var a = 0; a < zones.size(); a++) {
      for (var c = a + 1; c < zones.size(); c++) {
        for (var one : zones.get(a).areas()) {
          for (var two : zones.get(c).areas()) {
            if (overlaps(one, two)) throw new IllegalArgumentException("District volumes overlap");
          }
        }
      }
    }
    machines.forEach(m -> add(fixtures, arena.region(), m.block()));
    planeParts.forEach(p -> add(fixtures, arena.region(), p.block()));
    add(fixtures, arena.region(), planeWorkbench);
    add(fixtures, arena.region(), bossObjective);
    add(fixtures, arena.region(), expedition.returnSign());
    if (planeParts.size() != 5
        || planeParts.stream().map(PlanePart::id).distinct().count() != 5
        || machines.size() != MachineType.values().length
        || machines.stream().map(Machine::type).distinct().count() != MachineType.values().length)
      throw new IllegalArgumentException("Author five plane parts and every machine");
    validateRoutes(zones, ids);
    if (recipes.stream().map(Recipe::id).distinct().count() != recipes.size())
      throw new IllegalArgumentException("Duplicate recipe");
  }

  private static void add(Set<BlockPos> fixtures, Cuboid region, BlockPos pos) {
    if (!region.contains(pos) || !fixtures.add(pos))
      throw new IllegalArgumentException("Misplaced or duplicate fixture: " + pos);
  }

  private static void inside(Cuboid region, Cuboid area) {
    if (!region.contains(area.min()) || !region.contains(area.max()))
      throw new IllegalArgumentException("Area outside protected footprint");
  }

  private static boolean overlaps(Cuboid a, Cuboid b) {
    return Math.max(a.min().x(), b.min().x()) <= Math.min(a.max().x(), b.max().x())
        && Math.max(a.min().y(), b.min().y()) <= Math.min(a.max().y(), b.max().y())
        && Math.max(a.min().z(), b.min().z()) <= Math.min(a.max().z(), b.max().z());
  }

  private static void validateRoutes(List<Zone> zones, Set<String> ids) {
    var reached = new HashSet<String>();
    zones.stream().filter(z -> z.emeralds() == 0).map(Zone::id).forEach(reached::add);
    for (var pass = 0; pass < zones.size(); pass++) {
      for (var zone : zones) {
        if (!ids.containsAll(zone.requires()) || zone.requires().contains(zone.id()))
          throw new IllegalArgumentException("Invalid route: " + zone.id());
        if (reached.containsAll(zone.requires())) reached.add(zone.id());
      }
    }
    if (reached.isEmpty() || !reached.containsAll(ids))
      throw new IllegalArgumentException("Unreachable settlement districts");
  }
}
