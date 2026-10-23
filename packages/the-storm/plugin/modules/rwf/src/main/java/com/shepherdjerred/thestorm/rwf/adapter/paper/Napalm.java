// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/killstreak/streaks/
// NapalmKillstreak.java, with the fire it set through
// redwarfare-core/src/me/libraryaddict/core/condition/ConditionManager.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitAttacks;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCombat;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.Delivery;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.block.Block;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Item;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.util.Vector;

/**
 * Napalm: everyone near hears it coming; where it lands, every creature off the thrower's team
 * within 20 blocks is set alight (less the further off, and Fire Protection counted as Red Warfare
 * counted it), a power-9 blast hurts all of them, and a ring of fireballs sets the ground burning.
 * The fire it sets is the thrower's for as long as it burns: its damage is napalm's, through the
 * victim's armour, credited to the thrower. Main thread only.
 */
final class Napalm {

  /**
   * Fire napalm set on a creature, as Red Warfare's fire condition.
   *
   * @param owner who threw the napalm
   * @param ticksLeft how much longer the fire is theirs
   */
  private record Burn(CombatantId owner, int ticksLeft) {}

  private final MatchRunner runner;
  private final PaperContext context;
  private final Keys keys;
  private final KitExplosions explosions;
  private final Summons summons;
  private final StreakBlocks blocks;
  private final CombatTracker tracker;
  private final Sacrifices sacrifices;
  private final List<Item> fire = new ArrayList<>();
  private final Map<UUID, Burn> burns = new HashMap<>();

  /**
   * What napalm needs.
   *
   * @param keys entity tags
   * @param explosions the kit explosions, for the blast
   * @param blocks the blocks rewards change, for the fire it leaves
   * @param tracker hit bookkeeping, for its fire
   */
  record Parts(Keys keys, KitExplosions explosions, StreakBlocks blocks, CombatTracker tracker) {}

  Napalm(MatchRunner runner, PaperContext context, Summons summons, Parts parts) {
    this.runner = runner;
    this.context = context;
    this.summons = summons;
    this.keys = parts.keys();
    this.explosions = parts.explosions();
    this.blocks = parts.blocks();
    this.tracker = parts.tracker();
    this.sacrifices = new Sacrifices(runner, context, parts.tracker());
  }

  /**
   * Napalm is on its way: every player within 40 blocks of the thrower hears it, a warning for all
   * but the thrower's team. Red Warfare's spelling is kept.
   */
  void warn(Combatant owner, Player thrower) {
    for (var player : thrower.getWorld().getPlayers()) {
      if (Places.at(player).distance(Places.at(thrower)) > Delivery.NAPALM_WARNING) {
        continue;
      }
      var team = runner.memberOf(player.getUniqueId()).flatMap(Combatant::team);
      player.sendMessage(
          Component.text(
              team.isPresent() && team.equals(owner.team())
                  ? "Your team released napalm in the area!"
                  : "Napalm has been unleased in the area by " + thrower.getName() + "! Get out!",
              NamedTextColor.DARK_RED));
    }
  }

  /** The item that holds napalm's fireballs apart: Red Warfare named each uniquely. */
  private ItemStack fireball() {
    var stack = ItemStack.of(Material.FIRE_CHARGE);
    stack.editMeta(
        meta ->
            meta.displayName(
                Component.text(String.valueOf(System.nanoTime()), NamedTextColor.GRAY)
                    .decoration(TextDecoration.ITALIC, false)));
    return stack;
  }

  /** Napalm lands on {@code block}. */
  void land(Player owner, CombatantId id, TeamColor team, Block block) {
    var at = block.getLocation().add(0.5, 0.5, 0.5);
    at.getWorld().playSound(at, Sound.ENTITY_CREEPER_HURT, 3, 1.2F);
    for (var entity : at.getWorld().getLivingEntities()) {
      if (Places.at(entity).distance(at) > Delivery.NAPALM_REACH || !enemy(entity, team)) {
        continue;
      }
      var ticks = Delivery.fireTicks(Places.at(entity).distance(at));
      if (ticks <= 0 || entity.getFireTicks() > ticks) {
        continue;
      }
      var burning = Delivery.fireProtected(ticks, fireProtection(entity));
      burns.put(entity.getUniqueId(), new Burn(id, burning));
      entity.setFireTicks(burning);
    }
    owner.sendMessage(Component.text("Napalm has arrived!", NamedTextColor.DARK_RED));
    var blast =
        new AbilityEffect.Explode(
            Places.vec(at),
            Delivery.NAPALM_POWER,
            Delivery.NAPALM_MAX_DAMAGE,
            id,
            KitAttacks.NAPALM_BLAST,
            KitAttacks.NAPALM_BLAST,
            0);
    explosions.explode(blast, false);
    explosions.explodeOnCreatures(
        blast, creature -> !(creature instanceof ArmorStand) && enemy(creature, team));
    fireballs(at);
  }

  /** Whether {@code entity} is a living creature not of {@code team}, as napalm judged. */
  private boolean enemy(LivingEntity entity, TeamColor team) {
    return summons.creature(entity)
        && summons.alive(entity)
        && summons.teamOf(entity).filter(team::equals).isEmpty();
  }

  /** The Fire Protection levels {@code entity}'s armour carries in all. */
  private static int fireProtection(LivingEntity entity) {
    var equipment = entity.getEquipment();
    if (equipment == null) {
      return 0;
    }
    var levels = 0;
    for (var piece : equipment.getArmorContents()) {
      if (piece != null) {
        levels += KitFactory.enchantmentLevel(piece, "fire_protection");
      }
    }
    return levels;
  }

  /** Napalm's fireballs, thrown out in a ring to set the ground alight where they stop. */
  private void fireballs(Location at) {
    for (var x = -1F; x <= 1; x += Delivery.FIREBALL_STEP) {
      for (var z = -1F; z <= 1; z += Delivery.FIREBALL_STEP) {
        if (x * x + z * z > Delivery.FIREBALL_RING) {
          continue;
        }
        var velocity =
            new Vector(
                x / Delivery.FIREBALL_SPREAD, Delivery.FIREBALL_LIFT, z / Delivery.FIREBALL_SPREAD);
        fire.add(
            at.getWorld()
                .dropItem(
                    at,
                    fireball(),
                    item -> {
                      keys.tagKitEntity(item);
                      item.setPickupDelay(Delivery.FIREBALL_PICKUP_DELAY);
                      item.setPersistent(false);
                      item.setFireTicks(Delivery.FIREBALL_FIRE_TICKS);
                      item.setVelocity(velocity);
                    }));
      }
    }
  }

  // ---- its fire -----------------------------------------------------------------------------

  /** Who threw the napalm whose fire burns {@code victim}, while it burns. */
  Optional<CombatantId> burning(LivingEntity victim) {
    var burn = burns.get(victim.getUniqueId());
    if (burn == null || burn.ticksLeft() <= 0 || victim.getFireTicks() <= 0) {
      return Optional.empty();
    }
    return Optional.of(burn.owner());
  }

  /**
   * Napalm's fire hurts {@code victim} for {@code amount}: as napalm, through their armour and kit
   * and the hit window, credited to {@code owner}.
   */
  void scorch(Player victim, double amount, CombatantId owner) {
    var side = runner.kits().side(victim.getUniqueId());
    if (side.isEmpty()) {
      return;
    }
    var random = runner.match().random(runner.now());
    var hit = DamageFormula.Hit.of(KitAttacks.NAPALM, amount, KitFactory.armor(victim));
    var damage =
        PaperKitResistance.apply(
            victim,
            KitCombat.damage(hit, Optional.empty(), side.orElseThrow(), random),
            KitAttacks.NAPALM);
    var landed = summons.window(victim, damage, KitAttacks.NAPALM);
    if (landed <= 0) {
      return;
    }
    tracker.hit(victim, damage, Optional.of(owner.uuid()), KitAttacks.NAPALM);
    summons.hooks().hurt().accept(victim);
    victim.getWorld().playSound(Places.at(victim), Sound.ENTITY_PLAYER_HURT, 1, 1);
    if (sacrifices.shieldFor(owner.uuid(), victim, hit)) {
      return;
    }
    runner.damaged(victim, Optional.of(owner.uuid()), landed, KitAttacks.NAPALM);
    Harm.take(victim, landed);
    runner.kits().hurt(victim, KitAttacks.NAPALM, landed);
  }

  // ---- the clock ----------------------------------------------------------------------------

  /** One tick: the fire's hold runs down, and the fireballs smoke, fly and land. */
  void tick(long ticks) {
    burnDown();
    fly(ticks);
  }

  /** The fire's hold on each creature runs down a tick, and goes with the fire or the creature. */
  private void burnDown() {
    for (var entry : List.copyOf(burns.entrySet())) {
      var entity = context.mapWorld().getEntity(entry.getKey());
      var left = entry.getValue().ticksLeft() - 1;
      if (entity == null || !entity.isValid() || entity.isDead() || left <= 0) {
        burns.remove(entry.getKey());
      } else {
        burns.put(entry.getKey(), new Burn(entry.getValue().owner(), left));
      }
    }
  }

  /** The fireballs rekindle, smoke while they fly, and set the ground alight where they stop. */
  private void fly(long ticks) {
    for (var item : List.copyOf(fire)) {
      if (ticks % Delivery.FIREBALL_REKINDLE_EVERY == 0) {
        item.setFireTicks(Delivery.FIREBALL_FIRE_TICKS);
      }
      if (!item.isValid() || Places.at(item).getY() < 0) {
        item.remove();
        fire.remove(item);
        continue;
      }
      context.guarded(
          "smoke a napalm fireball",
          () -> item.getWorld().spawnParticle(Particle.POOF, Places.at(item), 1, 0, 0, 0, 0));
      if (item.getVelocity().length() > Delivery.FIREBALL_STOPPED) {
        continue;
      }
      item.remove();
      fire.remove(item);
      var block = Places.at(item).getBlock();
      if (block.getType().isAir()) {
        blocks.place(block, Material.FIRE.createBlockData());
      }
    }
  }

  /** The match reset: the fireballs and the fire's hold go. */
  void reset() {
    fire.forEach(Item::remove);
    fire.clear();
    burns.clear();
  }
}
