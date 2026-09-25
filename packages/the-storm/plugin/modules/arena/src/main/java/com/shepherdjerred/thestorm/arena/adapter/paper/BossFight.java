package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.boss.AbilityClock;
import com.shepherdjerred.thestorm.arena.domain.boss.HeartState;
import com.shepherdjerred.thestorm.arena.domain.boss.Push;
import com.shepherdjerred.thestorm.arena.domain.boss.Targets;
import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.Point;
import com.shepherdjerred.thestorm.arena.domain.wave.AbilitySpec;
import com.shepherdjerred.thestorm.arena.domain.wave.AbilityType;
import com.shepherdjerred.thestorm.arena.domain.wave.BarColor;
import com.shepherdjerred.thestorm.arena.domain.wave.BossOrder;
import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.bossbar.BossBar;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.attribute.Attribute;
import org.bukkit.block.data.BlockData;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.util.Vector;
import org.jspecify.annotations.Nullable;

/**
 * A boss in play: its health bar, its abilities on their cooldowns and, for the Creaking, its
 * heart. Main thread only.
 */
final class BossFight {

  private static final int TICKS_PER_SECOND = 20;

  private final LivingEntity entity;
  private final BossOrder order;
  private final ArenaWorld arena;
  private final BossBar bar;
  private final Set<UUID> viewers = new HashSet<>();
  private AbilityClock clock;
  private Optional<HeartState> heart;
  private int heartSpot;
  private @Nullable BlockData replaced;

  BossFight(LivingEntity entity, BossOrder order, ArenaWorld arena, Instant now) {
    this.entity = entity;
    this.order = order;
    this.arena = arena;
    this.bar =
        BossBar.bossBar(
            Component.text(order.boss().name()),
            1,
            color(order.boss().bar()),
            BossBar.Overlay.PROGRESS);
    this.clock = AbilityClock.start(order.boss().abilities(), now);
    this.heart =
        order.boss().abilities().stream()
            .filter(ability -> ability.type() == AbilityType.HEART)
            .findFirst()
            .map(HeartState::of);
    this.heartSpot = arena.randomMobSpawn();
    if (heart.isPresent()) {
      placeHeart();
    }
  }

  LivingEntity entity() {
    return entity;
  }

  String name() {
    return order.boss().name();
  }

  boolean alive() {
    return entity.isValid() && !entity.isDead();
  }

  /** Whether only breaking its heart can hurt the boss. */
  boolean guardedByHeart() {
    return heart.isPresent();
  }

  /** Updates the health bar for {@code audience} and uses any abilities that are ready. */
  void tick(Instant now, Collection<Player> fighters, Collection<Player> audience) {
    updateBar(audience);
    if (!alive()) {
      return;
    }
    var fired = clock.fire(now);
    clock = fired.clock();
    for (var ability : fired.due()) {
      use(ability, fighters);
    }
  }

  private void updateBar(Collection<Player> audience) {
    var max = entity.getAttribute(Attribute.MAX_HEALTH);
    var progress = max == null || !alive() ? 0 : entity.getHealth() / max.getValue();
    bar.progress((float) Math.clamp(progress, 0, 1));
    for (var player : audience) {
      if (viewers.add(player.getUniqueId())) {
        player.showBossBar(bar);
      }
    }
  }

  private void use(AbilitySpec ability, Collection<Player> fighters) {
    var origin = Places.point(entity.getLocation());
    var positions = positions(fighters);
    switch (ability.type()) {
      case LIGHTNING_AURA ->
          Targets.within(origin, positions, ability.radius())
              .forEach(id -> strike(player(fighters, id), ability.power()));
      case CHAIN_LIGHTNING ->
          Targets.chain(origin, positions, ability.radius(), ability.count())
              .forEach(id -> strike(player(fighters, id), ability.power()));
      case DISORIENT ->
          Targets.within(origin, positions, ability.radius())
              .forEach(id -> disorient(player(fighters, id), ability.power()));
      case SUMMON_ADDS ->
          arena.summon(
              ability.summon().orElseThrow(),
              ability.count(),
              entity.getLocation(),
              order.damage());
      case KNOCKBACK_SLAM ->
          Targets.within(origin, positions, ability.radius())
              .forEach(id -> slam(player(fighters, id), origin, ability.power()));
      case SHIELD_BREAK ->
          Targets.within(origin, positions, ability.radius())
              .forEach(id -> breakShield(player(fighters, id), ability.power()));
      case HEART -> moveHeart();
    }
  }

  private static Map<UUID, Point> positions(Collection<Player> fighters) {
    var positions = new HashMap<UUID, Point>();
    fighters.forEach(
        player -> positions.put(player.getUniqueId(), Places.point(Places.at(player))));
    return positions;
  }

  private static Player player(Collection<Player> fighters, UUID id) {
    return fighters.stream()
        .filter(player -> player.getUniqueId().equals(id))
        .findFirst()
        .orElseThrow(() -> new IllegalStateException("targets come from the fighters"));
  }

  private void strike(Player target, double damage) {
    target.getWorld().strikeLightningEffect(Places.at(target));
    target.damage(damage, entity);
  }

  private static void disorient(Player target, double seconds) {
    var ticks = (int) Math.round(seconds * TICKS_PER_SECOND);
    target.addPotionEffect(new PotionEffect(PotionEffectType.NAUSEA, ticks, 0));
    target.addPotionEffect(new PotionEffect(PotionEffectType.SLOWNESS, ticks, 1));
    // Spin the fighter around; a teleport is the rotation players' clients always follow.
    var turned = Places.at(target).clone();
    turned.setYaw(turned.getYaw() + 180);
    target.teleport(turned);
  }

  private void slam(Player target, Point origin, double strength) {
    var push = Push.away(origin, Places.point(Places.at(target)), strength);
    target.damage(strength * 2, entity);
    target.setVelocity(new Vector(push.x(), push.y(), push.z()));
  }

  private static void breakShield(Player target, double seconds) {
    target.setCooldown(Material.SHIELD, (int) Math.round(seconds * TICKS_PER_SECOND));
    target.getWorld().playSound(Places.at(target), Sound.ITEM_SHIELD_BREAK, 1, 1);
  }

  /** Whether {@code block} is the boss's heart. */
  boolean isHeart(BlockPos block) {
    return heart.isPresent() && arena.mobSpawnBlock(heartSpot).equals(block);
  }

  /**
   * A fighter hit the heart. Returns true if it broke: the boss loses its share of max health and
   * the heart grows back elsewhere.
   */
  boolean hitHeart() {
    var state = heart.orElseThrow(() -> new IllegalStateException("this boss has no heart"));
    var hit = state.hit();
    heart = Optional.of(hit.heart());
    return switch (hit) {
      case HeartState.Hit.Cracked _ -> {
        entity.getWorld().playSound(entity.getLocation(), Sound.BLOCK_CREAKING_HEART_HIT, 1, 1);
        yield false;
      }
      case HeartState.Hit.Broken broken -> {
        var max = entity.getAttribute(Attribute.MAX_HEALTH);
        var lost = (max == null ? entity.getHealth() : max.getValue()) * broken.damageFraction();
        entity.setHealth(Math.max(0, entity.getHealth() - lost));
        moveHeart();
        yield true;
      }
    };
  }

  private void moveHeart() {
    if (heart.isEmpty()) {
      return;
    }
    removeHeart();
    heartSpot = arena.relocate(heartSpot);
    placeHeart();
  }

  private void placeHeart() {
    var block = arena.block(arena.mobSpawnBlock(heartSpot));
    replaced = block.getBlockData();
    block.setType(Material.CREAKING_HEART, false);
  }

  private void removeHeart() {
    var previous = replaced;
    if (previous != null) {
      arena.block(arena.mobSpawnBlock(heartSpot)).setBlockData(previous, false);
      replaced = null;
    }
  }

  /** Ends the fight: the bar disappears and the heart block is put back. */
  void end() {
    for (var id : viewers) {
      var player = entity.getServer().getPlayer(id);
      if (player != null) {
        player.hideBossBar(bar);
      }
    }
    viewers.clear();
    removeHeart();
    heart = Optional.empty();
  }

  private static BossBar.Color color(BarColor color) {
    return switch (color) {
      case PINK -> BossBar.Color.PINK;
      case BLUE -> BossBar.Color.BLUE;
      case RED -> BossBar.Color.RED;
      case GREEN -> BossBar.Color.GREEN;
      case YELLOW -> BossBar.Color.YELLOW;
      case PURPLE -> BossBar.Color.PURPLE;
      case WHITE -> BossBar.Color.WHITE;
    };
  }
}
