package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.survival.Settlement;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Predicate;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.Player;

/** Protected geometry, deliberate gates and rescue anchors share the same authored areas. */
final class SettlementMap {
  private final ArenaWorld world;
  private final SurvivalContent content;
  private final Settlement state;
  private final Map<String, UUID> trapOwners = new HashMap<>();
  private final Map<UUID, Location> lastSafe = new HashMap<>();
  private final Set<UUID> visitors = new HashSet<>();

  SettlementMap(ArenaWorld world, SurvivalContent content) {
    this.world = world;
    this.content = content;
    state = new Settlement(content);
  }

  SurvivalContent content() {
    return content;
  }

  Settlement state() {
    return state;
  }

  List<SurvivalContent.Zone> open() {
    return content.zones().stream().filter(z -> state.accessible(z.id())).toList();
  }

  Optional<SurvivalContent.Zone> zone(Location at) {
    return content.zones().stream().filter(z -> z.contains(Places.point(at))).findFirst();
  }

  Optional<SurvivalContent.Zone> zone(Player player) {
    return zone(Places.at(player));
  }

  boolean offshore(Location at) {
    return content.expedition().area().contains(Places.point(at));
  }

  boolean combat(Location at) {
    return zone(at).filter(z -> state.accessible(z.id())).isPresent();
  }

  boolean allowed(Player player) {
    var at = Places.at(player);
    return world.contains(at)
        && (combat(at) || (visitors.contains(player.getUniqueId()) && offshore(at)));
  }

  void visit(UUID id, boolean offshore) {
    if (offshore) visitors.add(id);
    else visitors.remove(id);
  }

  void contain(Player player, Predicate<Location> castDanger) {
    var at = Places.at(player);
    if (allowed(player)) {
      if (standing(at) && !threatened(at, castDanger))
        lastSafe.put(player.getUniqueId(), at.clone());
      return;
    }
    var safe = rescue(player.getUniqueId(), at, castDanger);
    player.teleport(safe);
    player.setFallDistance(0);
    player.setVelocity(new org.bukkit.util.Vector());
    player.setNoDamageTicks(40);
    Texts.info(player, "Returned to the nearest safe route.");
  }

  Location rescue(UUID id, Location from, Predicate<Location> castDanger) {
    var candidates = new ArrayList<Location>();
    for (var zone : open()) {
      zone.safePoints().forEach(p -> candidates.add(Places.location(world.world(), p)));
    }
    if (visitors.contains(id))
      content
          .expedition()
          .safePoints()
          .forEach(p -> candidates.add(Places.location(world.world(), p)));
    var previous = lastSafe.get(id);
    if (previous != null && (combat(previous) || (visitors.contains(id) && offshore(previous))))
      candidates.add(previous);
    return candidates.stream()
        .filter(SettlementMap::standing)
        .min(
            Comparator.comparing((Location at) -> threatened(at, castDanger))
                .thenComparingDouble(at -> threatened(at, castDanger) ? -clearance(at) : 0)
                .thenComparingDouble(at -> at.distanceSquared(from)))
        .orElseThrow(() -> new IllegalStateException("No valid settlement rescue anchor"))
        .clone();
  }

  private boolean threatened(Location at, Predicate<Location> danger) {
    return danger.test(at) || clearance(at) < 36;
  }

  private double clearance(Location at) {
    return world.enemies().stream()
        .mapToDouble(e -> e.getLocation().distanceSquared(at))
        .min()
        .orElse(Double.MAX_VALUE);
  }

  private static boolean standing(Location at) {
    var feet = at.getBlock();
    var floor = at.clone().add(0, -0.1, 0).getBlock();
    return feet.isPassable()
        && !feet.isLiquid()
        && !Set.of(Material.FIRE, Material.SOUL_FIRE, Material.POWDER_SNOW).contains(feet.getType())
        && feet.getRelative(org.bukkit.block.BlockFace.UP).isPassable()
        && !java.util.Objects.requireNonNull(at.getWorld())
            .hasCollisionsIn(
                new org.bukkit.util.BoundingBox(
                    at.getX() - .3,
                    at.getY(),
                    at.getZ() - .3,
                    at.getX() + .3,
                    at.getY() + 1.8,
                    at.getZ() + .3))
        && floor.isCollidable()
        && !Set.of(Material.MAGMA_BLOCK, Material.CAMPFIRE, Material.SOUL_CAMPFIRE, Material.CACTUS)
            .contains(floor.getType());
  }

  Location entrance(Player target) {
    var points =
        offshore(Places.at(target))
            ? content.expedition().spawns()
            : zone(target)
                .orElseThrow(() -> new IllegalStateException("Fighter outside combat district"))
                .spawns();
    return points.stream()
        .map(p -> Places.location(world.world(), p))
        .filter(SettlementMap::standing)
        .max(Comparator.comparingDouble(at -> at.distanceSquared(Places.at(target))))
        .orElseThrow(() -> new IllegalStateException("Enemy entrance is obstructed"));
  }

  void reset() {
    state.reset();
    trapOwners.clear();
    lastSafe.clear();
    visitors.clear();
    for (var zone : content.zones()) {
      zone.defenses()
          .forEach(
              d -> {
                if (d.type() == SurvivalContent.DefenseType.BARRICADE)
                  barricade(d, Material.OAK_FENCE);
                else world.block(d.block()).setType(Material.STONE_PRESSURE_PLATE, false);
              });
    }
    gates();
    labels();
  }

  void labels() {
    content.arena().classSigns().forEach((id, block) -> label(block, id, "Select class", "", ""));
    for (var zone : content.zones()) {
      zone.purchaseSigns()
          .forEach(
              p -> {
                if (state.accessible(zone.id())) world.block(p).setType(Material.AIR, false);
                else {
                  world.block(p).setType(Material.OAK_SIGN, false);
                  label(
                      p,
                      zone.name(),
                      zone.emeralds() + " emeralds",
                      "Click twice",
                      "within 3 seconds");
                }
              });
    }
    content
        .planeParts()
        .forEach(p -> label(p.block(), p.name(), "Plane part / fuel", "Carry to airstrip", ""));
    label(content.planeWorkbench(), "Airstrip", "Install / board", "Rounds continue", "");
    label(
        content.expedition().returnSign(),
        "Return flight",
        "Back to Settlement",
        "Rounds continue",
        "");
  }

  void label(BlockPos pos, String... lines) {
    if (!(world.block(pos).getState() instanceof org.bukkit.block.Sign sign))
      throw new IllegalStateException("Authored sign missing: " + pos);
    for (var side : org.bukkit.block.sign.Side.values()) {
      var text = sign.getSide(side);
      for (var i = 0; i < 4; i++) text.line(i, Component.text(lines[i]));
    }
    sign.setWaxed(true);
    sign.update(true, false);
  }

  void unlock(SurvivalContent.Zone zone) {
    state.unlock(zone);
    gates();
    labels();
  }

  private void gates() {
    for (var route : content.routes()) {
      var open = route.districts().stream().allMatch(state::accessible);
      var zone =
          content.zones().stream()
              .filter(z -> z.id().equals(route.gateZone()))
              .findFirst()
              .orElseThrow();
      zone.gate()
          .forEach(p -> world.block(p).setType(open ? Material.AIR : Material.IRON_BARS, false));
    }
  }

  Optional<SurvivalContent.Zone> gate(BlockPos pos) {
    return content.zones().stream()
        .filter(z -> !state.accessible(z.id()))
        .filter(z -> z.purchaseSigns().contains(pos))
        .findFirst();
  }

  Optional<SurvivalContent.Station> station(BlockPos pos) {
    return open().stream()
        .flatMap(z -> z.stations().stream())
        .filter(s -> s.block().equals(pos))
        .findFirst();
  }

  Optional<SurvivalContent.Resource> resource(BlockPos pos) {
    return open().stream()
        .flatMap(z -> z.resources().stream())
        .filter(r -> r.block().equals(pos))
        .findFirst();
  }

  Optional<SurvivalContent.Defense> defense(BlockPos pos) {
    return open().stream()
        .flatMap(z -> z.defenses().stream())
        .filter(d -> d.block().equals(pos))
        .findFirst();
  }

  Optional<SurvivalContent.Machine> machine(BlockPos pos) {
    return content.machines().stream().filter(m -> m.contains(pos)).findFirst();
  }

  String powerDistrict() {
    var generator =
        content.machines().stream()
            .filter(machine -> machine.type() == SurvivalContent.MachineType.POWER)
            .findFirst()
            .orElseThrow();
    return content.zones().stream()
        .filter(zone -> zone.contains(generator.block()))
        .findFirst()
        .orElseThrow()
        .name();
  }

  BlockPos objective() {
    return content.bossObjective();
  }

  void arm(SurvivalContent.Defense defense, UUID player) {
    state.arm(defense.id());
    trapOwners.put(defense.id(), player);
  }

  void charge(Location at) {
    open().stream()
        .flatMap(z -> z.defenses().stream())
        .filter(d -> d.type() == SurvivalContent.DefenseType.BARRICADE)
        .filter(d -> Places.location(world.world(), d.block().center()).distanceSquared(at) < 25)
        .forEach(
            d -> {
              while (state.strength(d.id()) > 0) state.breach(d.id());
              barricade(d, Material.AIR);
            });
  }

  void repairAll() {
    open().stream()
        .flatMap(z -> z.defenses().stream())
        .filter(d -> d.type() == SurvivalContent.DefenseType.BARRICADE)
        .forEach(
            d -> {
              state.repair(d.id());
              barricade(d, Material.OAK_FENCE);
            });
  }

  void restoreNearby(Location at, UUID owner) {
    open().stream()
        .flatMap(zone -> zone.defenses().stream())
        .filter(
            defense ->
                Places.location(world.world(), defense.block().center()).distanceSquared(at) <= 144)
        .forEach(
            defense -> {
              if (defense.type() == SurvivalContent.DefenseType.BARRICADE) {
                if (state.strength(defense.id()) < 5) state.repair(defense.id());
                barricade(defense, Material.OAK_FENCE);
              } else if (state.strength(defense.id()) == 0) arm(defense, owner);
            });
  }

  void tick(java.util.function.BiConsumer<org.bukkit.entity.LivingEntity, UUID> credit) {
    for (var zone : open()) zone.defenses().forEach(d -> tickDefense(d, credit));
  }

  private void tickDefense(
      SurvivalContent.Defense defense,
      java.util.function.BiConsumer<org.bukkit.entity.LivingEntity, UUID> credit) {
    if (state.strength(defense.id()) == 0) return;
    var at = Places.location(world.world(), defense.block().center());
    var enemies =
        world.enemies().stream().filter(e -> e.getLocation().distanceSquared(at) < 9).toList();
    if (enemies.isEmpty()) return;
    if (defense.type() == SurvivalContent.DefenseType.BARRICADE) {
      if (state.breach(defense.id())) barricade(defense, Material.AIR);
    } else {
      state.breach(defense.id());
      var owner =
          java.util.Objects.requireNonNull(
              trapOwners.remove(defense.id()), "Charged trap has no owner");
      enemies.forEach(
          e -> {
            credit.accept(e, owner);
            e.damage(12);
            if (defense.type() == SurvivalContent.DefenseType.FLAME_TRAP) e.setFireTicks(80);
          });
      world.world().playSound(at, org.bukkit.Sound.BLOCK_ANVIL_LAND, 0.5f, 1.5f);
    }
  }

  void barricade(SurvivalContent.Defense defense, Material material) {
    for (var dx = -1; dx <= 1; dx++) {
      var block = defense.block();
      world.block(new BlockPos(block.x() + dx, block.y(), block.z())).setType(material, false);
    }
  }
}
