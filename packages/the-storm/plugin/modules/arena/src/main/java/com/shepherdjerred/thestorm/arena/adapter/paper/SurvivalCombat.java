package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.store.SurvivalProgress;
import com.shepherdjerred.thestorm.arena.domain.survival.EncounterDirector;
import com.shepherdjerred.thestorm.arena.domain.wave.SpawnUnit;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveTable;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/** Bounded encounter spawning, credit attribution, telegraphed bosses and stuck-mob recovery. */
final class SurvivalCombat {
  record Services(
      PaperContext context,
      WaveTable waves,
      SurvivalProgress progress,
      UUID run,
      SurvivalItems items,
      Consumer<SurvivalProgress.Credit> credit) {}

  private record Hit(UUID player, Instant at) {}

  private record Movement(Location at, int still) {}

  private final ArenaWorld world;
  private final SettlementMap map;
  private final Services services;
  private final ArrayDeque<SpawnUnit> queue = new ArrayDeque<>();
  private final Set<UUID> bounties = new HashSet<>();
  private final Map<UUID, Map<UUID, Hit>> hits = new HashMap<>();
  private final Map<UUID, Movement> movement = new HashMap<>();
  private @Nullable SurvivalBoss boss;
  private EncounterDirector.@Nullable Encounter encounter;
  private int round;
  private Instant nextSpawn = Instant.MIN;

  SurvivalCombat(ArenaWorld world, SettlementMap map, Services services) {
    this.world = world;
    this.map = map;
    this.services = services;
  }

  Optional<SurvivalBoss> boss() {
    return Optional.ofNullable(boss);
  }

  boolean clear() {
    return queue.isEmpty() && world.alive() == 0;
  }

  void begin(int number, int players, List<Player> audience) {
    world.clearAmbientHostiles();
    round = number;
    nextSpawn = services.context().time().instant();
    encounter = EncounterDirector.plan(number, players, map.state().open());
    var plan = encounter;
    for (var i = 0; i < plan.count(); i++) {
      var id = plan.roster().get(services.context().random().nextInt(plan.roster().size()));
      queue.add(new SpawnUnit(id, plan.health(), plan.damage(), services.waves().entities(id)));
    }
    if (!plan.boss().isEmpty()) {
      var hp = Math.min(1000, (120 + number * 12.0) * (1 + (players - 1) * 0.5));
      var spawned =
          world.spawnAt(new SpawnUnit(plan.boss(), hp, plan.damage(), 1), entrance(), true);
      if (spawned.isEmpty()) {
        throw new IllegalStateException("Boss spawn refused");
      }
      spawned.orElseThrow().forEach(e -> bounties.add(e.getUniqueId()));
      boss =
          new SurvivalBoss(
              new SurvivalBoss.Spawn(
                  plan.boss(), spawned.orElseThrow().getFirst(), map.objective()),
              world,
              services.context().time().instant());
    }
    audience.forEach(
        p ->
            Texts.info(
                p,
                "Round "
                    + number
                    + ": "
                    + plan.event()
                    + (plan.boss().isEmpty() ? "" : " — " + boss().orElseThrow().name())));
  }

  private Location entrance() {
    var zones = map.open();
    var zone = zones.get(services.context().random().nextInt(zones.size()));
    return Places.location(world.world(), zone.entrance());
  }

  void tick(List<Player> fighters, List<Player> audience) {
    spawnQueued();
    world.think(fighters);
    world.contain();
    if (!fighters.isEmpty()) {
      world.enemies().forEach(enemy -> recover(enemy, fighters));
    }
    boss()
        .ifPresent(
            b -> {
              b.tick(services.context().time().instant(), fighters, audience);
              if (b.charged()) {
                map.charge(b.entity().getLocation());
              }
            });
    map.tick(
        (enemy, id) -> {
          var player = services.context().server().getPlayer(id);
          if (player != null) {
            hit(enemy, player);
          }
        });
  }

  private void spawnQueued() {
    var plan = java.util.Objects.requireNonNull(encounter);
    var cap = Math.min(map.content().entityCap(), plan.concurrentLimit());
    var now = services.context().time().instant();
    var spawnedThisTick = 0;
    while (!queue.isEmpty()
        && !now.isBefore(nextSpawn)
        && world.alive() + queue.getFirst().entities() <= cap
        && spawnedThisTick < plan.spawnBatch()) {
      var spawned = world.spawnAt(queue.removeFirst(), entrance(), false);
      if (spawned.isEmpty()) {
        throw new IllegalStateException("Survival mob spawn refused");
      }
      spawned.orElseThrow().forEach(this::prepareEnemy);
      spawnedThisTick++;
    }
    if (spawnedThisTick > 0) {
      nextSpawn = now.plusSeconds(plan.spawnIntervalSeconds());
    }
  }

  private void prepareEnemy(LivingEntity enemy) {
    if (round <= 3 && enemy instanceof org.bukkit.entity.Zombie zombie) {
      zombie.setAdult();
      java.util.Objects.requireNonNull(
              zombie.getAttribute(org.bukkit.attribute.Attribute.SPAWN_REINFORCEMENTS))
          .setBaseValue(0);
      var equipment = zombie.getEquipment();
      if (equipment != null) {
        equipment.clear();
      }
    }
    bounties.add(enemy.getUniqueId());
  }

  private void recover(LivingEntity enemy, List<Player> fighters) {
    if (enemy.getVehicle() != null) {
      return;
    }
    var at = enemy.getLocation();
    var last = movement.get(enemy.getUniqueId());
    var still = last != null && last.at().distanceSquared(at) < 0.1 ? last.still() + 1 : 0;
    movement.put(enemy.getUniqueId(), new Movement(at.clone(), still));
    if (!(enemy instanceof Mob mob) || still < 5) {
      return;
    }
    var target =
        fighters.stream()
            .min(java.util.Comparator.comparingDouble(p -> Places.at(p).distanceSquared(at)))
            .orElseThrow();
    mob.getPathfinder().moveTo(target, 1.0);
    if (still >= 20 && at.distanceSquared(Places.at(target)) > 36) {
      enemy.teleport(entrance());
      movement.remove(enemy.getUniqueId());
    }
  }

  void hit(LivingEntity enemy, Player player) {
    if (!world.isWaveMob(enemy)) {
      return;
    }
    hits.computeIfAbsent(enemy.getUniqueId(), _ -> new HashMap<>())
        .put(
            player.getUniqueId(),
            new Hit(player.getUniqueId(), services.context().time().instant()));
  }

  void died(LivingEntity enemy, Set<UUID> fighters) {
    movement.remove(enemy.getUniqueId());
    var damage = hits.remove(enemy.getUniqueId());
    if (!bounties.remove(enemy.getUniqueId()) || damage == null) {
      return;
    }
    var isBoss = boss().filter(b -> b.entity().equals(enemy)).isPresent();
    for (var hit : damage.values()) {
      if (!fighters.contains(hit.player())
          || hit.at().plusSeconds(20).isBefore(services.context().time().instant())) {
        continue;
      }
      reward(enemy, hit, isBoss);
    }
    if (isBoss) {
      boss().orElseThrow().end();
    }
  }

  private void reward(LivingEntity enemy, Hit hit, boolean isBoss) {
    var player = services.context().server().getPlayer(hit.player());
    if (player == null) {
      return;
    }
    services.items().give(player, Material.EMERALD, isBoss ? 12 : 2);
    services.items().give(player, round % 3 == 0 ? Material.IRON_INGOT : Material.OAK_PLANKS, 1);
    services
        .credit()
        .accept(
            new SurvivalProgress.Credit(
                hit.player(), services.run(), "kill:" + enemy.getUniqueId(), isBoss ? 50 : 2));
  }

  void reset() {
    boss().ifPresent(SurvivalBoss::end);
    boss = null;
    encounter = null;
    nextSpawn = Instant.MIN;
    queue.clear();
    bounties.clear();
    hits.clear();
    movement.clear();
  }
}
