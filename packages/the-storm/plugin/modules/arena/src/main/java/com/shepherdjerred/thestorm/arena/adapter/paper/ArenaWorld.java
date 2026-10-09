package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.arena.ArenaDefinition;
import com.shepherdjerred.thestorm.arena.domain.boss.HeartState;
import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.ChunkPos;
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
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.attribute.Attribute;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;
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
  private final Map<UUID, CubePursuitGoal> cubeGoals = new HashMap<>();

  OptionalDouble cubeProgress(LivingEntity enemy) {
    cubeGoals.keySet().removeIf(id -> world.getEntity(id) == null);
    var goal = cubeGoals.get(enemy.getUniqueId());
    return goal == null ? OptionalDouble.empty() : OptionalDouble.of(goal.progress());
  }

  private final Map<UUID, List<Wolf>> wolves = new HashMap<>();
  private @Nullable BossFight boss;
  private boolean prepared;
  private boolean preloading;
  private boolean chunksReady;
  private boolean preloadFailed;
  private int preloadGeneration;
  private CompletableFuture<Void> preloadCompletion = CompletableFuture.completedFuture(null);
  private final List<ChunkPos> heldChunks = new ArrayList<>();

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

  void setBlock(BlockPos position, BlockData replacement) {
    var block = block(position);
    if (!contains(block.getLocation())) {
      throw new IllegalArgumentException(
          "Arena block change outside its authored region: " + position);
    }
    parts.context().blocks().set("#storm-arena-" + definition.id(), block, replacement, false);
  }

  void setBlock(BlockPos position, Material material) {
    setBlock(position, material.createBlockData());
  }

  List<String> chestProblems() {
    if (!chunksReady) {
      throw new IllegalStateException(
          "arena " + definition.id() + " chests checked before chunks loaded");
    }
    return parts.chests().problems();
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

  void tag(Entity entity) {
    parts.keys().tag(entity, definition.id());
    entity.setPersistent(false);
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
        setBlock(spawn.block(), Material.AIR);
      }
    }
    parts.chests().empty();
  }

  /** Loads each chunk asynchronously, then attaches its ticket on the main thread. */
  void preload() {
    if (preloading || chunksReady || preloadFailed || prepared) {
      return;
    }
    preloading = true;
    preloadCompletion = new CompletableFuture<>();
    var generation = ++preloadGeneration;
    var loads =
        definition.region().chunks().stream()
            .map(
                chunk ->
                    world
                        .getChunkAtAsync(chunk.x(), chunk.z(), false)
                        // Paper completes this future on the server thread. Take the plugin
                        // ticket before yielding: its temporary load ticket can expire before
                        // a callback scheduled for another tick runs.
                        .thenAccept(
                            loaded -> {
                              if (generation != preloadGeneration) {
                                return;
                              }
                              if (loaded == null || !world.isChunkLoaded(chunk.x(), chunk.z())) {
                                throw new IllegalStateException(
                                    "arena chunk " + chunk + " is unavailable");
                              }
                              parts.chunks().keep(world, List.of(chunk));
                              heldChunks.add(chunk);
                            }))
            .toArray(CompletableFuture[]::new);
    var _ =
        CompletableFuture.allOf(loads)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  if (generation != preloadGeneration) {
                    return;
                  }
                  preloading = false;
                  if (failure != null) {
                    parts
                        .context()
                        .logger()
                        .error("Could not preload arena {}", definition.id(), failure);
                    preloadFailed = true;
                    releaseChunks();
                    preloadCompletion.completeExceptionally(failure);
                  } else {
                    chunksReady = true;
                    preloadCompletion.complete(null);
                  }
                },
                parts.context().mainThread());
  }

  /** Startup's asynchronous chunk load, completed after its main-thread tickets are held. */
  CompletableFuture<Void> startupPreload() {
    preload();
    return preloadCompletion;
  }

  boolean chunksReady() {
    return chunksReady;
  }

  boolean preloadFailed() {
    return preloadFailed;
  }

  void cancelPreload() {
    preloadGeneration++;
    if (!preloadCompletion.isDone()) {
      preloadCompletion.completeExceptionally(
          new IllegalStateException("arena " + definition.id() + " preload cancelled"));
    }
    preloading = false;
    preloadFailed = false;
    chunksReady = false;
    releaseChunks();
  }

  private void releaseChunks() {
    for (var chunk : heldChunks) {
      parts.chunks().release(world, List.of(chunk));
    }
    heldChunks.clear();
  }

  void prepare() {
    if (!chunksReady) {
      throw new IllegalStateException("arena " + definition.id() + " started before chunks loaded");
    }
    prepared = true;
    parts.chests().fill(parts.context().random());
  }

  void restock() {
    parts.chests().restock(parts.context().random());
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
        var entities = spawned.orElseThrow();
        if (ArenaPlacement.ensure(entities.getFirst(), definition)) {
          track(unit.mob(), entities);
        } else {
          entities.forEach(Entity::remove);
          allSpawned = false;
        }
      }
    }
    return allSpawned;
  }

  /** Imported or wandering hostile mobs cannot bypass survival's encounter and credit rules. */
  void clearAmbientHostiles() {
    world.getEntities().stream()
        .filter(org.bukkit.entity.Enemy.class::isInstance)
        .filter(entity -> contains(entity.getLocation()))
        .filter(entity -> parts.keys().arenaOf(entity).isEmpty())
        .forEach(Entity::remove);
  }

  /** Survival's authored entrances and encounter controller share the same tracked entity cap. */
  Optional<List<LivingEntity>> spawnAt(SpawnUnit unit, Location at, boolean bossHealth) {
    if (alive() + unit.entities() > parts.entityCap() || !contains(at)) {
      return Optional.empty();
    }
    var result =
        parts
            .factory()
            .spawn(
                at,
                unit.mob(),
                bossHealth
                    ? MobFactory.Tuning.boss(unit.health(), unit.damage())
                    : MobFactory.Tuning.relative(unit.health(), unit.damage()),
                definition.id());
    result.ifPresent(spawned -> track(unit.mob(), spawned));
    return result;
  }

  List<LivingEntity> enemies() {
    alive();
    return List.copyOf(mobs);
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
    if (!ArenaPlacement.ensure(spawned.getFirst(), definition)) {
      spawned.forEach(Entity::remove);
      return false;
    }
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
  boolean adopt(LivingEntity offspring) {
    if (alive() >= parts.entityCap()) {
      return false;
    }
    parts.keys().tag(offspring, definition.id());
    offspring.setPersistent(false);
    pursuitRange(offspring);
    mobs.add(offspring);
    return true;
  }

  private void track(String mob, List<LivingEntity> spawned) {
    mobs.addAll(spawned);
    var archetype = parts.table().mob(mob);
    for (var entity : spawned) {
      if (entity instanceof org.bukkit.entity.AbstractCubeMob cube) {
        var goal = new CubePursuitGoal(cube, parts.context().time());
        cubeGoals.put(cube.getUniqueId(), goal);
        parts.context().server().getMobGoals().addGoal(cube, 0, goal);
      }
      pursuitRange(entity);
      if (archetype.behavior() != Behavior.VANILLA) {
        brains.put(entity.getUniqueId(), archetype);
      }
      if (archetype.rider().isPresent()) {
        archetype = parts.table().mob(archetype.rider().orElseThrow());
      }
    }
  }

  /**
   * Vanilla navigation must be able to plan a path across the whole arena, including for riders.
   */
  private void pursuitRange(LivingEntity mob) {
    var range = mob.getAttribute(Attribute.FOLLOW_RANGE);
    if (range != null) {
      var region = definition.region();
      var x = (double) region.max().x() - region.min().x() + 1;
      var y = (double) region.max().y() - region.min().y() + 1;
      var z = (double) region.max().z() - region.min().z() + 1;
      range.setBaseValue(Math.max(range.getBaseValue(), Math.sqrt(x * x + y * y + z * z)));
    }
  }

  boolean isWaveMob(Entity entity) {
    return mobs.contains(entity);
  }

  boolean isFriendlyWolf(Entity entity) {
    return wolves.values().stream().anyMatch(pack -> pack.contains(entity));
  }

  int companions() {
    return (int)
        wolves.values().stream()
            .flatMap(List::stream)
            .filter(w -> w.isValid() && !w.isDead())
            .count();
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

  /** Every hostile wave mob hunts a fighter; special behaviors add to its native combat AI. */
  void think(Collection<Player> fighters) {
    for (var mob : List.copyOf(mobs)) {
      if (!mob.isValid() || mob.isDead()) {
        continue;
      }
      think(mob, fighters);
    }
  }

  private void think(LivingEntity mob, Collection<Player> fighters) {
    var archetype = brains.get(mob.getUniqueId());
    var nearest = nearest(mob, fighters);
    var distance =
        nearest
            .map(player -> OptionalDouble.of(Places.at(player).distance(mob.getLocation())))
            .orElseGet(OptionalDouble::empty);
    // Only special behaviors have a brain entry; vanilla mobs and adopted offspring still hunt.
    var behavior = archetype == null ? Behavior.VANILLA : archetype.behavior();
    if (nearest.isEmpty() && mob instanceof Mob hunter) {
      hunter.setTarget(null);
    }
    switch (MobBrain.decide(behavior, distance)) {
      case NOTHING -> {
        // No fighter, or a harmless follower already within its following distance.
      }
      case HUNT -> {
        if (mob instanceof Mob hunter) {
          hunt(hunter, nearest.orElseThrow(), distance.orElseThrow());
        }
      }
      case APPROACH -> {
        if (mob instanceof Mob follower) {
          follower.getPathfinder().moveTo(Places.at(nearest.orElseThrow()));
        }
      }
      case DETONATE -> {
        if (archetype == null) {
          throw new IllegalStateException("kamikaze mob has no archetype");
        }
        detonate(mob, archetype);
      }
    }
  }

  static void hunt(Mob hunter, Player target, double distance) {
    if (!target.equals(hunter.getTarget())) {
      hunter.setTarget(target);
    }
    // The cube hop goal reads native paths but owns movement; a second navigator fights its hops.
    if (hunter instanceof org.bukkit.entity.AbstractCubeMob) return;
    // A target alone does not start navigation for every native goal, especially at range.
    // Let close-range ranged combat keep its native strafing and attack behavior.
    var navigator = hunter.getVehicle() instanceof Mob mount ? mount : hunter;
    if (distance > 16 || (distance > 4 && !navigator.getPathfinder().hasPath())) {
      // Cross-map routes include long stair runs; close combat retains native movement.
      navigator.getPathfinder().moveTo(target, distance > 16 ? 1.2 : 1.0);
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
        .filter(player -> player.isValid() && !player.isDead())
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
    cubeGoals.clear();
    wolves.values().forEach(pack -> pack.forEach(Entity::remove));
    wolves.clear();
    for (var entity : world.getEntities()) {
      if (owns(entity)) {
        entity.remove();
      }
    }
    parts.chests().empty();
    cancelPreload();
    prepared = false;
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
