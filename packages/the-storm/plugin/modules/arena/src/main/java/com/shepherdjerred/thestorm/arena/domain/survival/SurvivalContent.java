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
    BlockPos bossObjective,
    List<Route> routes,
    List<BoxSite> boxSites,
    List<ClassProfile> classes,
    List<LegendaryReward> legendaries,
    BlockPos lobbyGuide) {
  public enum StationType {
    WORKBENCH,
    FORGE,
    INFIRMARY,
    ALCHEMY,
    BANK
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
    STONEWARD,
    GALESTRIDE,
    EMBERWEAVE,
    SOULBOND,
    RUNEFORGE
  }

  public record Station(BlockPos block, StationType type) {}

  public record Machine(BlockPos block, MachineType type, List<BlockPos> interactions) {
    public Machine {
      interactions = List.copyOf(interactions);
    }

    public boolean contains(BlockPos pos) {
      return block.equals(pos) || interactions.contains(pos);
    }
  }

  /** A physical gate collection opens only when every adjoining district is accessible. */
  public record Route(String id, String gateZone, Set<String> districts) {
    public Route {
      districts = Set.copyOf(districts);
      if (id.isBlank() || !districts.contains(gateZone))
        throw new IllegalArgumentException("Invalid gate connection " + id);
    }
  }

  public record BoxSite(String id, String zone, BlockPos block, BlockPos beacon) {}

  public record Specialty(Specialization id, String name, String description) {}

  public record ClassProfile(
      SurvivalClass role, String passive, String ability, List<Specialty> specializations) {
    public ClassProfile {
      specializations = List.copyOf(specializations);
      if (passive.isBlank()
          || ability.isBlank()
          || specializations.size() != 2
          || specializations.stream().map(Specialty::id).distinct().count() != 2
          || specializations.stream().anyMatch(s -> s.id().role() != role))
        throw new IllegalArgumentException("Invalid class profile " + role);
    }
  }

  public record LegendaryReward(
      LegendaryWeapon id, String name, String material, String description, int weight) {
    public LegendaryReward {
      if (name.isBlank() || description.isBlank() || weight < 1 || !material.equals(id.material()))
        throw new IllegalArgumentException("Invalid legendary reward " + id);
    }
  }

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
      ResourceKind.valueOf(material);
      if (amount < 1 || perRound != 2)
        throw new IllegalArgumentException("Harvest budgets must be two per material per round");
    }
  }

  public record Defense(String id, BlockPos block, DefenseType type) {}

  public enum PotionKind {
    NONE,
    HEALING,
    REGENERATION,
    SWIFTNESS,
    STRENGTH,
    FIRE_RESISTANCE
  }

  public enum EquipmentEnchantment {
    SHARPNESS,
    SMITE,
    POWER,
    PROTECTION,
    UNBREAKING,
    PIERCING,
    QUICK_CHARGE,
    LOYALTY
  }

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
          || (emeralds > 0 && purchaseSigns.isEmpty())
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
      Map<String, Integer> ingredients,
      PotionKind potion,
      Map<EquipmentEnchantment, Integer> enchantments) {
    public Recipe {
      ingredients = Map.copyOf(ingredients);
      enchantments = Map.copyOf(enchantments);
      if (amount < 1
          || amount > 64
          || ingredients.isEmpty()
          || ingredients.values().stream().anyMatch(n -> n < 1))
        throw new IllegalArgumentException("Invalid recipe " + id);
      if (enchantments.values().stream().anyMatch(level -> level < 1))
        throw new IllegalArgumentException("Invalid recipe enchantment " + id);
    }
  }

  public SurvivalContent {
    zones = List.copyOf(zones);
    recipes = List.copyOf(recipes);
    machines = List.copyOf(machines);
    planeParts = List.copyOf(planeParts);
    routes = List.copyOf(routes);
    boxSites = List.copyOf(boxSites);
    classes = List.copyOf(classes);
    legendaries = List.copyOf(legendaries);
    if (entityCap < 8 || entityCap > 64 || arena.maxPlayers() != 4 || zones.isEmpty())
      throw new IllegalArgumentException(
          "Survival needs authored districts, four slots and an entity cap of 8..64");
    var ids = new HashSet<String>();
    var fixtures = new HashSet<BlockPos>();
    for (var zone : zones) {
      if (!ids.add(zone.id())) throw new IllegalArgumentException("Duplicate zone " + zone.id());
      zone.areas().forEach(a -> inside(arena.region(), a));
      if (zone.emeralds() > 0 && zone.gate().isEmpty())
        throw new IllegalArgumentException("Paid district needs a gate: " + zone.id());
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
    add(fixtures, arena.region(), lobbyGuide);
    if (!lobbyArea.contains(lobbyGuide))
      throw new IllegalArgumentException("Guide must be in lobby");
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
    machines.forEach(
        m -> {
          add(fixtures, arena.region(), m.block());
          m.interactions().forEach(p -> add(fixtures, arena.region(), p));
        });
    planeParts.forEach(p -> add(fixtures, arena.region(), p.block()));
    add(fixtures, arena.region(), planeWorkbench);
    add(fixtures, arena.region(), bossObjective);
    add(fixtures, arena.region(), expedition.returnSign());
    if (planeParts.isEmpty()
        || planeParts.stream().map(PlanePart::id).distinct().count() != planeParts.size()
        || machines.size() != MachineType.values().length
        || machines.stream().map(Machine::type).distinct().count() != MachineType.values().length)
      throw new IllegalArgumentException("Author distinct plane parts and every machine");
    validateRoutes(zones, ids);
    validateConnections(routes, zones, ids);
    validateProfiles(classes, legendaries);
    if (boxSites.size() < 2
        || boxSites.stream().map(BoxSite::id).distinct().count() != boxSites.size())
      throw new IllegalArgumentException("Author distinct mystery box sites");
    for (var site : boxSites) {
      var zone = zones.stream().filter(z -> z.id().equals(site.zone())).findFirst().orElseThrow();
      if (!zone.contains(site.block())
          || !arena.region().contains(site.beacon())
          || site.block().x() != site.beacon().x()
          || site.block().z() != site.beacon().z()
          || site.beacon().y() <= site.block().y())
        throw new IllegalArgumentException("Misplaced mystery box " + site.id());
      if (machines.stream()
          .noneMatch(m -> m.type() == MachineType.MYSTERY_BOX && m.block().equals(site.block())))
        add(fixtures, arena.region(), site.block());
      add(fixtures, arena.region(), site.beacon());
    }
    if (recipes.stream().map(Recipe::id).distinct().count() != recipes.size())
      throw new IllegalArgumentException("Duplicate recipe");
  }

  private static void validateConnections(List<Route> routes, List<Zone> zones, Set<String> ids) {
    var paid =
        zones.stream()
            .filter(z -> z.emeralds() > 0)
            .map(Zone::id)
            .collect(java.util.stream.Collectors.toUnmodifiableSet());
    var connected =
        routes.stream()
            .map(Route::gateZone)
            .collect(java.util.stream.Collectors.toUnmodifiableSet());
    if (!connected.equals(paid)
        || connected.size() != routes.size()
        || routes.stream().map(Route::id).distinct().count() != routes.size())
      throw new IllegalArgumentException("Every paid district needs one physical route connection");
    for (var route : routes) {
      var zone =
          zones.stream().filter(z -> z.id().equals(route.gateZone())).findFirst().orElseThrow();
      if (!ids.containsAll(route.districts()) || !route.districts().containsAll(zone.requires()))
        throw new IllegalArgumentException("Unknown or incomplete route " + route.id());
    }
  }

  private static void validateProfiles(
      List<ClassProfile> classes, List<LegendaryReward> legendaries) {
    if (classes.size() != SurvivalClass.values().length
        || classes.stream().map(ClassProfile::role).distinct().count() != classes.size()
        || legendaries.size() != LegendaryWeapon.values().length
        || legendaries.stream().map(LegendaryReward::id).distinct().count() != legendaries.size())
      throw new IllegalArgumentException("Author every class and legendary exactly once");
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
