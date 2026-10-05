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
      Consumer<SurvivalProgress.Credit> credit,
      Consumer<org.bukkit.entity.Trident> returnTrident) {}

  private record Hit(UUID player, Instant at) {}

  private record Movement(Location at, int still) {}

  private final ArenaWorld world;
  private final SettlementMap map;
  private final Services services;
  private final ArrayDeque<SpawnUnit> queue = new ArrayDeque<>();
  private final Map<UUID, List<LivingEntity>> units = new HashMap<>();
  private final Map<UUID, String> types = new HashMap<>();
  private final Map<UUID, Instant> nextShot = new HashMap<>();
  private final Map<UUID, Double> projectiles = new HashMap<>();
  private int total;
  private final Set<UUID> bounties = new HashSet<>();
  private final Map<UUID, Map<UUID, Hit>> hits = new HashMap<>();
  private final Map<UUID, Movement> movement = new HashMap<>();
  private @Nullable SurvivalBoss boss;
  private EncounterDirector.@Nullable Encounter encounter;
  private int round;
  private Instant nextSpawn = Instant.MIN;
  private boolean scriptedDamage;

  SurvivalCombat(ArenaWorld world, SettlementMap map, Services services) {
    this.world = world;
    this.map = map;
    this.services = services;
  }

  Optional<SurvivalBoss> boss() {
    return Optional.ofNullable(boss);
  }

  Optional<EncounterDirector.Event> encounter() {
    return Optional.ofNullable(encounter).map(EncounterDirector.Encounter::event);
  }

  int active() {
    return units.size();
  }

  int queued() {
    return queue.size();
  }

  int remaining() {
    return active() + queued();
  }

  int total() {
    return total;
  }

  int round() {
    return round;
  }

  boolean clear() {
    return queue.isEmpty() && units.isEmpty();
  }

  boolean castDanger(Location at) {
    return boss()
        .filter(SurvivalBoss::alive)
        .flatMap(SurvivalBoss::cast)
        .filter(cast -> cast.hits(Places.point(at)))
        .isPresent();
  }

  boolean bossEntity(org.bukkit.entity.Entity entity) {
    return boss().filter(b -> b.entity().equals(entity)).isPresent();
  }

  boolean scriptedDamage() {
    return scriptedDamage;
  }

  void damage(LivingEntity target, Player player, double amount) {
    hit(target, player);
    scriptedDamage = true;
    try {
      target.damage(amount, player);
    } finally {
      scriptedDamage = false;
    }
  }

  void projectile(org.bukkit.entity.Projectile projectile, double multiplier) {
    world.tag(projectile);
    projectiles.put(projectile.getUniqueId(), multiplier);
  }

  double projectileMultiplier(org.bukkit.entity.Projectile projectile) {
    return projectiles.getOrDefault(projectile.getUniqueId(), 1.0);
  }

  boolean ranged(org.bukkit.entity.Entity entity) {
    return EncounterDirector.ranged(types.getOrDefault(entity.getUniqueId(), ""));
  }

  boolean shot(org.bukkit.entity.LivingEntity shooter) {
    if (!ranged(shooter)) return !bossEntity(shooter);
    var now = services.context().time().instant();
    var target = shooter instanceof Mob mob ? mob.getTarget() : null;
    if (target == null || !shooter.hasLineOfSight(target)) return false;
    if (now.isBefore(nextShot.getOrDefault(shooter.getUniqueId(), Instant.MAX))) return false;
    nextShot.put(shooter.getUniqueId(), now.plusMillis(3000));
    return true;
  }

  double incoming(org.bukkit.entity.Entity source, double damage) {
    if (round <= 7 && ranged(source)) return Math.min(4, damage);
    return damage * java.util.Objects.requireNonNull(encounter).damage();
  }

  void begin(int number, int players, List<Player> audience) {
    world.clearAmbientHostiles();
    round = number;
    nextSpawn = services.context().time().instant();
    encounter = EncounterDirector.plan(number, players, map.state().open());
    var plan = encounter;
    for (var i = 0; i < plan.count(); i++) {
      var id =
          i < plan.specialBudget()
              ? plan.roster().get(services.context().random().nextInt(plan.roster().size()))
              : round == 1 || services.context().random().nextBoolean() ? "zombie" : "husk";
      queue.add(new SpawnUnit(id, plan.health(), plan.damage(), services.waves().entities(id)));
    }
    total = plan.count() + (plan.boss().isEmpty() ? 0 : 1);
    if (!plan.boss().isEmpty()) {
      var hp = EncounterDirector.bossHealth(number, players);
      var spawned =
          world.spawnAt(new SpawnUnit(plan.boss(), hp, plan.damage(), 1), entrance(), true);
      if (spawned.isEmpty()) {
        throw new IllegalStateException("Boss spawn refused");
      }
      register(plan.boss(), spawned.orElseThrow());
      boss =
          new SurvivalBoss(
              new SurvivalBoss.Spawn(
                  plan.boss(), spawned.orElseThrow().getFirst(), map.objective(), round),
              world,
              services.context().time().instant(),
              this::adds);
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

  private List<Player> fighters = List.of();

  private Location entrance() {
    if (!fighters.isEmpty())
      return map.entrance(fighters.get(services.context().random().nextInt(fighters.size())));
    var zones = map.open();
    var zone = zones.get(services.context().random().nextInt(zones.size()));
    return Places.location(world.world(), zone.entrance());
  }

  void tick(List<Player> fighters, List<Player> audience) {
    this.fighters = List.copyOf(fighters);
    units
        .entrySet()
        .removeIf(entry -> entry.getValue().stream().noneMatch(e -> e.isValid() && !e.isDead()));
    projectiles.keySet().removeIf(id -> services.context().server().getEntity(id) == null);
    spawnQueued();
    world.think(fighters);
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
    var now = services.context().time().instant();
    var spawnedThisTick = 0;
    while (!queue.isEmpty()
        && !now.isBefore(nextSpawn)
        && active() < activeLimit(plan)
        && world.alive() + world.companions() + queue.getFirst().entities()
            <= map.content().entityCap()
        && (!EncounterDirector.ranged(queue.getFirst().mob())
            || types.entrySet().stream()
                    .filter(e -> EncounterDirector.ranged(e.getValue()))
                    .filter(e -> services.context().server().getEntity(e.getKey()) != null)
                    .count()
                < plan.rangedLimit())
        && spawnedThisTick < plan.spawnBatch()) {
      var unit = queue.removeFirst();
      var spawned = world.spawnAt(unit, entrance(), false);
      if (spawned.isEmpty()) {
        throw new IllegalStateException("Survival mob spawn refused");
      }
      register(unit.mob(), spawned.orElseThrow());
      spawned.orElseThrow().forEach(this::prepareEnemy);
      spawnedThisTick++;
    }
    if (spawnedThisTick > 0) {
      nextSpawn = now.plusSeconds(plan.spawnIntervalSeconds());
    }
  }

  private int activeLimit(EncounterDirector.Encounter plan) {
    return plan.concurrentLimit()
        - (round == 5 && boss().filter(SurvivalBoss::alive).isEmpty() ? 1 : 0);
  }

  void probeTarget(LivingEntity entity) {
    register("zombie", List.of(entity));
  }

  private void register(String type, List<LivingEntity> entities) {
    units.put(entities.getLast().getUniqueId(), entities);
    for (var entity : entities) {
      types.put(entity.getUniqueId(), type);
      bounties.add(entity.getUniqueId());
      if (EncounterDirector.ranged(type)) {
        nextShot.put(entity.getUniqueId(), services.context().time().instant().plusSeconds(1));
        entity.customName(net.kyori.adventure.text.Component.text("Ranged · shot wind-up"));
        entity.setCustomNameVisible(true);
      }
    }
  }

  private void adds(int phase) {
    if (round < 10 || phase < 2) return;
    var plan = java.util.Objects.requireNonNull(encounter);
    for (var i = 0; i < Math.min(3, phase); i++) {
      queue.add(new SpawnUnit("zombie", plan.health(), plan.damage(), 1));
      total++;
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
      java.util.Objects.requireNonNull(
              zombie.getAttribute(org.bukkit.attribute.Attribute.MAX_HEALTH))
          .setBaseValue(6 + round * 2);
      zombie.setHealth(6 + round * 2);
      java.util.Objects.requireNonNull(
              zombie.getAttribute(org.bukkit.attribute.Attribute.ATTACK_DAMAGE))
          .setBaseValue(.5 + round * .5);
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
    var occupied =
        fighters.stream()
            .anyMatch(
                p -> {
                  var area =
                      map.zone(p)
                          .map(
                              com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent.Zone
                                  ::id);
                  return area.equals(
                          map.zone(at)
                              .map(
                                  com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent
                                          .Zone
                                      ::id))
                      && (area.isPresent()
                          || map.content().expedition().area().contains(Places.point(at)));
                });
    if (!occupied && still >= 5) {
      enemy.teleport(entrance());
      movement.remove(enemy.getUniqueId());
      return;
    }
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
    types.remove(enemy.getUniqueId());
    nextShot.remove(enemy.getUniqueId());
    var unit = units.remove(enemy.getUniqueId());
    if (unit != null)
      unit.stream().filter(e -> !e.equals(enemy)).forEach(org.bukkit.entity.Entity::remove);
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
    services.items().give(player, Material.EMERALD, (isBoss ? 12 : 2) * emeraldMultiplier);
    services.items().give(player, round % 3 == 0 ? Material.IRON_INGOT : Material.OAK_PLANKS, 1);
    services
        .credit()
        .accept(
            new SurvivalProgress.Credit(
                hit.player(), services.run(), "kill:" + enemy.getUniqueId(), isBoss ? 50 : 2));
  }

  private int emeraldMultiplier = 1;

  void doubleEmeralds(boolean enabled) {
    emeraldMultiplier = enabled ? 2 : 1;
  }

  void nuke() {
    queue.clear();
    for (var enemy : world.enemies()) {
      if (!bossEntity(enemy)) enemy.setHealth(0);
    }
  }

  void leave(UUID owner) {
    for (var id : List.copyOf(projectiles.keySet())) {
      var entity = services.context().server().getEntity(id);
      if (entity instanceof org.bukkit.entity.Projectile projectile
          && projectile.getShooter() instanceof Player player
          && player.getUniqueId().equals(owner)) {
        projectile.remove();
        projectiles.remove(id);
      }
    }
  }

  private void clearArrows() {
    for (var id : List.copyOf(projectiles.keySet())) {
      var entity = services.context().server().getEntity(id);
      if (entity instanceof org.bukkit.entity.Trident trident) {
        services.returnTrident().accept(trident);
        projectiles.remove(id);
      } else {
        if (entity != null) entity.remove();
        projectiles.remove(id);
      }
    }
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
    units.clear();
    types.clear();
    nextShot.clear();
    clearArrows();
    total = 0;
  }
}
