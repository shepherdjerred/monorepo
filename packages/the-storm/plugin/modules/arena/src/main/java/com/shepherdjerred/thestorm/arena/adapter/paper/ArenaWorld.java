package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.arena.ArenaDefinition;
import com.shepherdjerred.thestorm.arena.domain.boss.HeartState;
import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.wave.Behavior;
import com.shepherdjerred.thestorm.arena.domain.wave.BossOrder;
import com.shepherdjerred.thestorm.arena.domain.wave.MobArchetype;
import com.shepherdjerred.thestorm.arena.domain.wave.MobBrain;
import com.shepherdjerred.thestorm.arena.domain.wave.SpawnUnit;
import com.shepherdjerred.thestorm.arena.domain.wave.Tier;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveTable;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;
import org.bukkit.entity.SulfurCube;
import org.bukkit.entity.Wolf;
import org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason;
import org.jspecify.annotations.Nullable;

/**
 * The world side of one arena: its mobs, boss, wolves, loot chests and chunks. Mobs are counted
 * against the entity cap, kept inside the region, and driven by their custom AI every second. Main
 * thread only.
 */
final class ArenaWorld {

  /** How far from a mob spawn a mob may appear, so a crowd does not stack on one block. */
  private static final double SPREAD = 1.5;

  private final ArenaDefinition definition;
  private final World world;
  private final Parts parts;
  private final List<LivingEntity> mobs = new ArrayList<>();
  private final Map<UUID, MobArchetype> brains = new HashMap<>();
  private final Map<UUID, List<Wolf>> wolves = new HashMap<>();
  private @Nullable BossFight boss;
  private boolean prepared;

  /**
   * What an arena world is built from.
   *
   * @param context the shared server services
   * @param keys the arena tags
   * @param factory spawns mobs
   * @param chests the loot chests
   * @param chunks keeps chunks loaded
   * @param table the wave table, for summoned adds
   * @param tier the arena's tier, for summoned adds
   * @param entityCap the most arena mobs alive at once
   */
  record Parts(
      PaperContext context,
      Keys keys,
      MobFactory factory,
      LootChests chests,
      ChunkKeeper chunks,
      WaveTable table,
      Tier tier,
      int entityCap) {}

  ArenaWorld(ArenaDefinition definition, World world, Parts parts) {
    this.definition = definition;
    this.world = world;
    this.parts = parts;
  }

  World world() {
    return world;
  }

  ArenaDefinition definition() {
    return definition;
  }

  /** Whether {@code location} is inside the arena's region. */
  boolean contains(Location location) {
    return location.getWorld().equals(world)
        && definition.region().contains(Places.point(location));
  }

  /** Whether {@code location} is within {@code reach} blocks of the region (on any axis). */
  boolean near(Location location, int reach) {
    if (!location.getWorld().equals(world)) {
      return false;
    }
    var region = definition.region();
    return location.getBlockX() >= region.min().x() - reach
        && location.getBlockX() <= region.max().x() + reach
        && location.getBlockY() >= region.min().y() - reach
        && location.getBlockY() <= region.max().y() + reach
        && location.getBlockZ() >= region.min().z() - reach
        && location.getBlockZ() <= region.max().z() + reach;
  }

  /** Whether {@code entity} was spawned by this arena. */
  boolean owns(Entity entity) {
    return parts.keys().arenaOf(entity).filter(definition.id()::equals).isPresent();
  }

  /** At enable: removes what a crash may have left behind (mobs, hearts, loot). */
  void cleanUp() {
    for (var entity : world.getEntities()) {
      if (owns(entity)) {
        entity.remove();
      }
    }
    for (var spawn : definition.mobSpawns()) {
      var block = Places.block(world, spawn.block());
      if (block.getType() == Material.CREAKING_HEART) {
        block.setType(Material.AIR, false);
      }
    }
    parts.chests().empty();
  }

  void prepare() {
    parts.chunks().keep(world, definition.region().chunks());
    prepared = true;
    parts.chests().fill(parts.context().random());
  }

  /** Spawns the units; false if any spawn was refused (the rest are still tracked). */
  boolean spawn(List<SpawnUnit> units) {
    var allSpawned = true;
    for (var unit : units) {
      var spawned =
          parts
              .factory()
              .spawn(
                  randomSpawnLocation(),
                  unit.mob(),
                  MobFactory.Tuning.relative(unit.health(), unit.damage()),
                  definition.id());
      if (spawned.isEmpty()) {
        allSpawned = false;
      } else {
        track(unit.mob(), spawned.orElseThrow());
      }
    }
    return allSpawned;
  }

  /** Spawns the boss; false if its spawn was refused. */
  boolean spawnBoss(BossOrder order, Instant now) {
    var result =
        parts
            .factory()
            .spawn(
                randomSpawnLocation(),
                order.boss().mob(),
                MobFactory.Tuning.boss(order.maxHealth(), order.damage()),
                definition.id());
    if (result.isEmpty()) {
      return false;
    }
    var spawned = result.orElseThrow();
    track(order.boss().mob(), spawned);
    var entity = spawned.getFirst();
    entity.customName(Component.text(order.boss().name()));
    entity.setCustomNameVisible(true);
    endBoss();
    boss = new BossFight(entity, order, this, now);
    return true;
  }

  /** Adds summoned by a boss, as many as fit under the entity cap. */
  void summon(String mob, int count, Location near, double damage) {
    var entities = parts.table().entities(mob);
    var health = parts.table().mob(mob).health() * parts.tier().health();
    for (var i = 0; i < count && alive() + entities <= parts.entityCap(); i++) {
      parts
          .factory()
          .spawn(near, mob, MobFactory.Tuning.relative(health, damage), definition.id())
          .ifPresent(spawned -> track(mob, spawned));
    }
  }

  /**
   * Adopts a mob born inside the running arena from one of its own (a slime split, an evoker's
   * vexes, zombie reinforcements): tagged, counted towards the wave and kept inside.
   */
  void adopt(LivingEntity offspring) {
    parts.keys().tag(offspring, definition.id());
    offspring.setPersistent(false);
    mobs.add(offspring);
  }

  private void track(String mob, List<LivingEntity> spawned) {
    mobs.addAll(spawned);
    var archetype = parts.table().mob(mob);
    if (archetype.behavior() != Behavior.VANILLA) {
      brains.put(spawned.getFirst().getUniqueId(), archetype);
    }
  }

  /** Arena mobs alive now, riders and boss included. */
  int alive() {
    mobs.removeIf(mob -> !mob.isValid() || mob.isDead());
    brains.keySet().removeIf(id -> mobs.stream().noneMatch(mob -> mob.getUniqueId().equals(id)));
    return mobs.size();
  }

  /** Puts every mob that got out of the region back at a mob spawn. */
  void contain() {
    for (var mob : mobs) {
      if (mob.isValid() && !contains(mob.getLocation()) && mob.getVehicle() == null) {
        // Paper 26 keeps a mount's rider on teleport.
        mob.teleport(randomSpawnLocation());
      }
    }
  }

  /** One second of custom AI for mobs with a behavior. */
  void think(Collection<Player> fighters) {
    for (var mob : List.copyOf(mobs)) {
      var archetype = brains.get(mob.getUniqueId());
      if (archetype == null || !mob.isValid()) {
        continue;
      }
      var nearest = nearest(mob, fighters);
      var distance =
          nearest
              .map(player -> OptionalDouble.of(Places.at(player).distance(mob.getLocation())))
              .orElseGet(OptionalDouble::empty);
      switch (MobBrain.decide(archetype.behavior(), distance)) {
        case NOTHING -> {
          // Vanilla AI carries on.
        }
        case HUNT -> {
          if (mob instanceof Mob hunter) {
            hunter.setTarget(nearest.orElseThrow());
          }
        }
        case APPROACH -> {
          if (mob instanceof Mob follower) {
            follower.getPathfinder().moveTo(Places.at(nearest.orElseThrow()));
          }
        }
        case DETONATE -> detonate(mob, archetype);
      }
    }
  }

  private void detonate(LivingEntity mob, MobArchetype archetype) {
    if (mob instanceof SulfurCube cube) {
      cube.ignite();
      return;
    }
    world.createExplosion(mob.getLocation(), (float) archetype.blast(), false, false, mob);
    mob.remove();
  }

  private static Optional<Player> nearest(LivingEntity mob, Collection<Player> fighters) {
    return fighters.stream()
        .filter(player -> player.getWorld().equals(mob.getWorld()))
        .min(
            Comparator.comparingDouble(
                player -> Places.at(player).distanceSquared(mob.getLocation())));
  }

  Optional<BossFight> boss() {
    return Optional.ofNullable(boss);
  }

  /** Updates the boss's bar and abilities, and forgets a boss that died. */
  void tickBoss(Instant now, Collection<Player> fighters, Collection<Player> audience) {
    var current = boss;
    if (current == null) {
      return;
    }
    current.tick(now, fighters, audience);
    if (!current.alive()) {
      endBoss();
    }
  }

  private void endBoss() {
    var current = boss;
    if (current != null) {
      current.end();
      boss = null;
    }
  }

  void spawnWolves(Player owner, int count) {
    var pack = new ArrayList<Wolf>();
    for (var i = 0; i < count; i++) {
      pack.add(
          world.spawn(
              Places.at(owner),
              Wolf.class,
              wolf -> {
                wolf.setTamed(true);
                wolf.setOwner(owner);
                wolf.setPersistent(false);
                parts.keys().tag(wolf, definition.id());
              },
              SpawnReason.CUSTOM));
    }
    wolves.merge(
        owner.getUniqueId(),
        pack,
        (old, added) -> {
          var all = new ArrayList<>(old);
          all.addAll(added);
          return all;
        });
  }

  void removeWolves(UUID owner) {
    var pack = wolves.remove(owner);
    if (pack != null) {
      pack.forEach(Entity::remove);
    }
  }

  /** Removes every mob, the boss and all wolves, empties the chests and lets the chunks go. */
  void reset() {
    endBoss();
    mobs.forEach(Entity::remove);
    mobs.clear();
    brains.clear();
    wolves.values().forEach(pack -> pack.forEach(Entity::remove));
    wolves.clear();
    for (var entity : world.getEntities()) {
      if (owns(entity)) {
        entity.remove();
      }
    }
    parts.chests().empty();
    if (prepared) {
      parts.chunks().release(world, definition.region().chunks());
      prepared = false;
    }
  }

  int randomMobSpawn() {
    return parts.context().random().nextInt(definition.mobSpawns().size());
  }

  int relocate(int current) {
    return HeartState.relocate(current, definition.mobSpawns().size(), parts.context().random());
  }

  BlockPos mobSpawnBlock(int index) {
    return definition.mobSpawns().get(index).block();
  }

  Block block(BlockPos pos) {
    return Places.block(world, pos);
  }

  private Location randomSpawnLocation() {
    var spawn = definition.mobSpawns().get(randomMobSpawn());
    var random = parts.context().random();
    var location = Places.location(world, spawn);
    var spread =
        location
            .clone()
            .add(random.nextDouble(-SPREAD, SPREAD), 0, random.nextDouble(-SPREAD, SPREAD));
    return contains(spread) ? spread : location;
  }
}
