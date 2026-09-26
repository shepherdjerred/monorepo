package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.game.Member;
import com.shepherdjerred.thestorm.arena.domain.game.Notice;
import com.shepherdjerred.thestorm.arena.domain.game.NoticeKind;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.TNTPrimed;
import org.bukkit.entity.Wolf;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockDamageEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockIgniteEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.block.BlockSpreadEvent;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityCombustByBlockEvent;
import org.bukkit.event.entity.EntityCombustByEntityEvent;
import org.bukkit.event.entity.EntityCombustEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.entity.EntityTargetLivingEntityEvent;
import org.bukkit.event.entity.EntityTransformEvent;
import org.bukkit.event.entity.ItemSpawnEvent;
import org.bukkit.event.world.EntitiesLoadEvent;

/**
 * The arena's world rules while a game runs: no block changes, no drops, no stray fire or
 * explosions breaking the build; mobs that never burn in daylight, never drop loot or experience,
 * and only hunt fighters; and the boss fights.
 */
final class WorldListener implements Listener {

  private static final int TNT_FUSE_TICKS = 40;

  /** How far from its summoner a vanilla zombie reinforcement can appear, in blocks. */
  private static final int REINFORCEMENT_REACH = 48;

  private final Arenas arenas;
  private final Keys keys;

  WorldListener(Arenas arenas, Keys keys) {
    this.arenas = arenas;
    this.keys = keys;
  }

  /** The running arena containing {@code location}. */
  private Optional<GameRunner> running(Location location) {
    return arenas.runningAt(location);
  }

  /**
   * Whether {@code player} may not change the block at {@code location}: members never change
   * blocks anywhere, and nobody changes blocks in an arena while a game runs there.
   */
  private boolean guarded(Location location, UUID player) {
    return arenas.of(player).isPresent() || running(location).isPresent();
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onBreak(BlockBreakEvent event) {
    if (guarded(event.getBlock().getLocation(), event.getPlayer().getUniqueId())) {
      event.setCancelled(true);
    }
  }

  /** No building; a fighter's TNT is lit where it is placed instead (the Oddjob's trick). */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onPlace(BlockPlaceEvent event) {
    var player = event.getPlayer();
    var location = event.getBlock().getLocation();
    if (!guarded(location, player.getUniqueId())) {
      return;
    }
    event.setCancelled(true);
    var runner = arenas.arrived(player.getUniqueId());
    if (event.getBlock().getType() == Material.TNT
        && runner.isPresent()
        && runner.orElseThrow().isFighter(player.getUniqueId())
        && runner.orElseThrow().world().contains(location)) {
      var at = location.toCenterLocation();
      at.getWorld()
          .spawn(
              at,
              TNTPrimed.class,
              tnt -> {
                tnt.setSource(player);
                tnt.setFuseTicks(TNT_FUSE_TICKS);
                keys.tag(tnt, runner.orElseThrow().id());
              },
              SpawnReason.CUSTOM);
      event.getItemInHand().subtract();
    }
  }

  /** Fighters hit the Creaking's heart to break it. */
  @EventHandler(priority = EventPriority.HIGH)
  void onHeartHit(BlockDamageEvent event) {
    var pos = Places.pos(event.getBlock());
    for (var runner : arenas.all()) {
      var boss = runner.world().boss();
      if (boss.isPresent()
          && boss.orElseThrow().isHeart(pos)
          && runner.isFighter(event.getPlayer().getUniqueId())) {
        event.setCancelled(true);
        if (boss.orElseThrow().hitHeart()) {
          runner.announce(Notice.of(NoticeKind.HEART_BROKEN, "boss", boss.orElseThrow().name()));
        }
        return;
      }
    }
  }

  /**
   * Explosions never break arena blocks; an explosion from an arena mob, arena TNT, or anything a
   * member caused breaks no blocks at all.
   */
  @EventHandler(ignoreCancelled = true)
  void onExplode(EntityExplodeEvent event) {
    if (fromArena(event.getEntity())) {
      event.blockList().clear();
    } else {
      keepBlocks(event.blockList());
    }
  }

  private boolean fromArena(Entity entity) {
    if (keys.arenaOf(entity).isPresent()) {
      return true;
    }
    var source =
        switch (entity) {
          case TNTPrimed tnt -> tnt.getSource();
          case Projectile projectile ->
              projectile.getShooter() instanceof Entity shooter ? shooter : null;
          default -> null;
        };
    return source != null
        && (keys.arenaOf(source).isPresent() || arenas.of(source.getUniqueId()).isPresent());
  }

  @EventHandler(ignoreCancelled = true)
  void onBlockExplode(BlockExplodeEvent event) {
    keepBlocks(event.blockList());
  }

  private void keepBlocks(List<Block> blocks) {
    blocks.removeIf(block -> arenas.at(block.getLocation()).isPresent());
  }

  /** Members light nothing anywhere; nothing burns in a running arena. */
  @EventHandler(ignoreCancelled = true)
  void onIgnite(BlockIgniteEvent event) {
    var player = event.getPlayer();
    if (running(event.getBlock().getLocation()).isPresent()
        || (player != null && arenas.of(player.getUniqueId()).isPresent())) {
      event.setCancelled(true);
    }
  }

  /**
   * Arena mobs never change into other mobs (a drowned husk, a frozen stray, a zombified piglin),
   * which would leave the wave; slimes and magma cubes still split, and the pieces are adopted.
   */
  @EventHandler(ignoreCancelled = true)
  void onTransform(EntityTransformEvent event) {
    if (keys.arenaOf(event.getEntity()).isPresent()
        && event.getTransformReason() != EntityTransformEvent.TransformReason.SPLIT) {
      event.setCancelled(true);
    }
  }

  /**
   * Mobs born inside a running arena from its own mobs (slime splits, an evoker's vexes, zombie
   * reinforcements) belong to the wave: counted, contained and cleaned up.
   */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.MONITOR)
  void onOffspring(CreatureSpawnEvent event) {
    switch (event.getSpawnReason()) {
      case SLIME_SPLIT, SPELL, REINFORCEMENTS ->
          running(event.getLocation()).ifPresent(runner -> runner.world().adopt(event.getEntity()));
      default -> {
        // Only offspring are adopted; the arena tags its own spawns itself.
      }
    }
  }

  /**
   * Reinforcements summoned by arena zombies can land outside the region (they spawn up to about 40
   * blocks away); near a running arena those never spawn.
   */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onStrayReinforcement(CreatureSpawnEvent event) {
    if (event.getSpawnReason() != SpawnReason.REINFORCEMENTS) {
      return;
    }
    var location = event.getLocation();
    var near =
        arenas.all().stream()
            .filter(runner -> runner.game().phase().running())
            .filter(runner -> !runner.world().contains(location))
            .anyMatch(runner -> runner.world().near(location, REINFORCEMENT_REACH));
    if (near) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onBurn(BlockBurnEvent event) {
    if (arenas.at(event.getBlock().getLocation()).isPresent()) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onSpread(BlockSpreadEvent event) {
    if (event.getSource().getType() == Material.FIRE
        && arenas.at(event.getBlock().getLocation()).isPresent()) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onChangeBlock(EntityChangeBlockEvent event) {
    if (running(event.getBlock().getLocation()).isPresent()
        || keys.arenaOf(event.getEntity()).isPresent()) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onItemSpawn(ItemSpawnEvent event) {
    if (running(event.getLocation()).isPresent()) {
      event.setCancelled(true);
    }
  }

  /** Arena mobs drop nothing; a boss's death is announced. */
  @EventHandler(priority = EventPriority.HIGHEST)
  void onMobDeath(EntityDeathEvent event) {
    var entity = event.getEntity();
    var arena = keys.arenaOf(entity);
    if (arena.isEmpty() || entity instanceof Player) {
      return;
    }
    event.getDrops().clear();
    event.setDroppedExp(0);
    arenas
        .byId(arena.orElseThrow())
        .ifPresent(
            runner ->
                runner
                    .world()
                    .boss()
                    .filter(boss -> boss.entity().equals(entity))
                    .ifPresent(
                        boss ->
                            runner.announce(
                                Notice.of(NoticeKind.BOSS_DEFEATED, "boss", boss.name()))));
  }

  /** Daylight never burns arena mobs; fire and fire aspect still do. */
  @EventHandler(ignoreCancelled = true)
  void onCombust(EntityCombustEvent event) {
    var sunlight =
        !(event instanceof EntityCombustByBlockEvent)
            && !(event instanceof EntityCombustByEntityEvent);
    if (sunlight && keys.arenaOf(event.getEntity()).isPresent()) {
      event.setCancelled(true);
    }
  }

  /** Arena mobs hunt only that arena's fighters (and their wolves), never passers-by. */
  @EventHandler(ignoreCancelled = true)
  void onTarget(EntityTargetLivingEntityEvent event) {
    var arena = keys.arenaOf(event.getEntity());
    if (arena.isEmpty() || !(event.getTarget() instanceof Player target)) {
      return;
    }
    var fighter =
        arenas.byId(arena.orElseThrow()).filter(runner -> runner.isFighter(target.getUniqueId()));
    if (fighter.isEmpty()) {
      event.setCancelled(true);
    }
  }

  /** A boss guarded by its heart takes no damage but from its heart breaking. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onDamage(EntityDamageEvent event) {
    var entity = event.getEntity();
    var arena = keys.arenaOf(entity);
    if (arena.isEmpty()) {
      return;
    }
    arenas
        .byId(arena.orElseThrow())
        .flatMap(runner -> runner.world().boss())
        .filter(boss -> boss.entity().equals(entity) && boss.guardedByHeart())
        .ifPresent(boss -> event.setCancelled(true));
  }

  /** Fighters cannot hurt each other or each other's wolves, not even with TNT or arrows. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onFriendlyFire(EntityDamageByEntityEvent event) {
    var attacker = responsible(event.getDamager());
    if (attacker.isEmpty()) {
      return;
    }
    var runner = arenas.of(attacker.orElseThrow().getUniqueId());
    if (runner.isEmpty()) {
      return;
    }
    var victim = event.getEntity();
    var friendly =
        victim instanceof Player player
            ? runner
                .orElseThrow()
                .member(player.getUniqueId())
                .filter(Member.Fighter.class::isInstance)
                .isPresent()
            : keys.arenaOf(victim).isPresent() && victim instanceof Wolf;
    if (friendly) {
      event.setCancelled(true);
    }
  }

  private static Optional<Player> responsible(Entity damager) {
    return switch (damager) {
      case Player player -> Optional.of(player);
      case Projectile projectile when projectile.getShooter() instanceof Player shooter ->
          Optional.of(shooter);
      case TNTPrimed tnt when tnt.getSource() instanceof Player source -> Optional.of(source);
      default -> Optional.empty();
    };
  }

  /** Arena entities loaded without a game (after a crash) are removed. */
  @EventHandler
  void onEntitiesLoad(EntitiesLoadEvent event) {
    for (var entity : event.getEntities()) {
      var arena = keys.arenaOf(entity);
      if (arena.isPresent()
          && arenas
              .byId(arena.orElseThrow())
              .filter(runner -> runner.game().phase().running())
              .isEmpty()) {
        entity.remove();
      }
    }
  }
}
