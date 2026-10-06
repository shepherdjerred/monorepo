package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalDrop;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.TextDisplay;
import org.jspecify.annotations.Nullable;

/** One visible team pickup, with local bounded effects and a first-encounter inspection delay. */
final class ZombiesDrops {
  private record Field(SurvivalDrop kind, Location at, UUID owner, Instant until) {}

  private final SurvivalRunner runner;
  private final Map<UUID, Integer> surge = new HashMap<>();
  private final Map<UUID, Instant> approached = new HashMap<>();
  private final java.util.List<Field> fields = new java.util.ArrayList<>();
  private Instant nextDrop = Instant.MIN;
  private Instant expires = Instant.MIN;
  private Instant nextField = Instant.MIN;
  private Instant nextFlash = Instant.MIN;
  private boolean visible = true;
  private @Nullable SurvivalDrop kind;
  private @Nullable ItemDisplay display;
  private @Nullable TextDisplay label;

  ZombiesDrops(SurvivalRunner runner) {
    this.runner = runner;
  }

  void died(LivingEntity enemy) {
    var now = runner.context().time().instant();
    if (display != null || now.isBefore(nextDrop) || runner.context().random().nextInt(100) >= 8)
      return;
    var kinds = java.util.List.of(SurvivalDrop.values());
    drop(
        kinds.get(runner.context().random().nextInt(kinds.size())),
        enemy.getLocation().add(0, 1, 0));
  }

  void drop(SurvivalDrop drop, Location at) {
    if (display != null) throw new IllegalStateException("A field pickup is already outstanding");
    kind = drop;
    var now = runner.context().time().instant();
    display = at.getWorld().spawn(at, ItemDisplay.class);
    display.setItemStack(
        org.bukkit.inventory.ItemStack.of(SurvivalItems.material(kind.material())));
    display.setPersistent(false);
    runner.tag(display);
    label = at.getWorld().spawn(at.clone().add(0, .6, 0), TextDisplay.class);
    label.text(Component.text(kind.title() + "\n" + kind.description()));
    label.setLineWidth(220);
    label.setBillboard(org.bukkit.entity.Display.Billboard.CENTER);
    label.setPersistent(false);
    runner.tag(label);
    expires = now.plusSeconds(20);
    nextFlash = expires.minusSeconds(5);
    visible = true;
    nextDrop = now.plusSeconds(30);
  }

  void tick() {
    var now = runner.context().time().instant();
    if (!now.isBefore(nextField)) {
      nextField = now.plusSeconds(1);
      fields.removeIf(field -> !now.isBefore(field.until()));
      fields.forEach(this::field);
    }
    var pickup = display;
    if (pickup == null) return;
    if (!pickup.isValid() || !now.isBefore(expires)) {
      clear();
      return;
    }
    var drop = java.util.Objects.requireNonNull(kind);
    flash(pickup, drop, now);
    for (var player : runner.fighters()) {
      if (approach(player, pickup, drop, now)) {
        collect(player, drop, pickup.getLocation(), now);
        clear();
        return;
      }
    }
    if (visible && pickup.getTicksLived() % 5 == 0)
      pickup.getWorld().spawnParticle(Particle.END_ROD, pickup.getLocation(), 4, .4, .3, .4, .01);
  }

  private void flash(ItemDisplay pickup, SurvivalDrop drop, Instant now) {
    if (!now.isBefore(nextFlash)) {
      nextFlash = now.plusMillis(250);
      visible = !visible;
      pickup.setItemStack(
          visible
              ? runner.items().stack(SurvivalItems.material(drop.material()), 1)
              : org.bukkit.inventory.ItemStack.empty());
      java.util.Objects.requireNonNull(label)
          .text(
              visible
                  ? Component.text(drop.title() + "\n" + drop.description())
                  : Component.empty());
    }
  }

  private boolean approach(Player player, ItemDisplay pickup, SurvivalDrop drop, Instant now) {
    if (Places.at(player).distanceSquared(pickup.getLocation()) > 64) return false;
    if (!approached.containsKey(player.getUniqueId())) {
      approached.put(player.getUniqueId(), now);
      runner
          .tips()
          .encounter(
              player,
              new com.shepherdjerred.thestorm.arena.domain.survival.TutorialKey(
                  com.shepherdjerred.thestorm.arena.domain.survival.TutorialKey.Topic.DROP,
                  drop.name()));
    }
    var familiar =
        runner
            .tips()
            .seen(
                player,
                new com.shepherdjerred.thestorm.arena.domain.survival.TutorialKey(
                    com.shepherdjerred.thestorm.arena.domain.survival.TutorialKey.Topic.DROP,
                    drop.name()));
    return Places.at(player).distanceSquared(pickup.getLocation()) <= 4
        && (familiar
            || !now.isBefore(
                java.util.Objects.requireNonNull(approached.get(player.getUniqueId()))
                    .plusSeconds(2)));
  }

  private void collect(Player player, SurvivalDrop drop, Location at, Instant now) {
    switch (drop) {
      case WILDGROWTH, MASONS_ECHO ->
          fields.add(new Field(drop, at.clone(), player.getUniqueId(), now.plusSeconds(8)));
      case REDSTONE_SURGE -> runner.fighters().forEach(ally -> surge.put(ally.getUniqueId(), 3));
      case RESONANT_SHARD -> runner.fighters().forEach(ally -> runner.talents().resonate(ally));
      case COPPER_PULSE ->
          runner.world().enemies().stream()
              .filter(
                  enemy ->
                      enemy.getLocation().distanceSquared(at) <= 100
                          && player.hasLineOfSight(enemy))
              .limit(8)
              .forEach(
                  enemy -> {
                    runner.combat().damage(enemy, player, 6);
                    if (!runner.combat().bossEntity(enemy))
                      enemy.addPotionEffect(
                          new org.bukkit.potion.PotionEffect(
                              org.bukkit.potion.PotionEffectType.SLOWNESS, 40, 2));
                  });
    }
    runner
        .online()
        .forEach(
            ally -> {
              ally.playSound(at, org.bukkit.Sound.BLOCK_AMETHYST_BLOCK_CHIME, .65f, 1.2f);
              Texts.info(ally, drop.title() + " · " + drop.description());
              runner.hud().hint(ally, drop.title(), 4);
            });
  }

  private void field(Field field) {
    var particle =
        field.kind() == SurvivalDrop.WILDGROWTH ? Particle.HAPPY_VILLAGER : Particle.WAX_ON;
    for (var angle = 0; angle < 16; angle++) {
      var radians = angle * Math.PI / 8;
      field
          .at()
          .getWorld()
          .spawnParticle(
              particle,
              field.at().clone().add(Math.cos(radians) * 4, -.5, Math.sin(radians) * 4),
              1,
              0,
              0,
              0,
              0);
    }
    if (field.kind() == SurvivalDrop.WILDGROWTH)
      runner.fighters().stream()
          .filter(player -> Places.at(player).distanceSquared(field.at()) <= 25)
          .forEach(player -> SurvivalItems.heal(player, 1));
    else runner.map().restoreNearby(field.at(), field.owner());
  }

  void hit(Player player, LivingEntity target) {
    if (runner.combat().scriptedDamage() || !runner.world().isWaveMob(target)) return;
    var charges = surge.getOrDefault(player.getUniqueId(), 0);
    if (charges == 0) return;
    surge.put(player.getUniqueId(), charges - 1);
    runner.world().enemies().stream()
        .filter(
            enemy ->
                !enemy.equals(target)
                    && enemy.getLocation().distanceSquared(target.getLocation()) <= 16
                    && target.hasLineOfSight(enemy)
                    && player.hasLineOfSight(enemy))
        .limit(2)
        .forEach(enemy -> runner.combat().damage(enemy, player, 3));
    player.spawnParticle(
        Particle.ELECTRIC_SPARK, target.getLocation().add(0, 1, 0), 12, .4, .4, .4, .03);
    runner.hud().hint(player, "Redstone Surge · " + (charges - 1) + " attacks remain", 2);
  }

  private void clear() {
    if (display != null) display.remove();
    if (label != null) label.remove();
    display = null;
    label = null;
    kind = null;
    approached.clear();
  }

  void reset() {
    clear();
    fields.clear();
    surge.clear();
    nextDrop = Instant.MIN;
  }
}
