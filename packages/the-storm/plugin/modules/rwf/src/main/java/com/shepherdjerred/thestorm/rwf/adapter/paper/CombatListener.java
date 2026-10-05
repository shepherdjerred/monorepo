package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.CombatRules;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.combat.HitWindow;
import com.shepherdjerred.thestorm.rwf.domain.combat.Knockback;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import io.papermc.paper.event.entity.EntityKnockbackEvent;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.AbstractArrow;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.FoodLevelChangeEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerItemConsumeEvent;
import org.bukkit.inventory.ItemStack;

/**
 * Red Warfare combat, only inside the rwf world and only between living members of a live match.
 * The server's damage event is cancelled and the hit is applied here instead: damage from {@link
 * DamageFormula} through {@link HitWindow}, knockback from {@link Knockback} with the attacker's
 * sprint reset, no sweep attacks, no hunger, instant steaks. Everything else (golden apples, fall
 * damage, fire) is vanilla. Bukkit's own damage-modifier API is deprecated, so adjusting the event
 * in place is not an option; cancelling and applying keeps the formula exact.
 */
final class CombatListener implements Listener {

  private final MatchRunner runner;
  private final CombatTracker tracker;
  private final PaperContext context;
  private final ServerHooks hooks;

  CombatListener(
      MatchRunner runner, CombatTracker tracker, PaperContext context, ServerHooks hooks) {
    this.runner = runner;
    this.tracker = tracker;
    this.context = context;
    this.hooks = hooks;
  }

  private boolean inWorld(Entity entity) {
    return entity.getWorld().equals(context.world());
  }

  /** The player behind a hit: the attacker, or the shooter of a projectile. */
  static Optional<Player> responsible(Entity damager) {
    return switch (damager) {
      case Player player -> Optional.of(player);
      case Projectile projectile when projectile.getShooter() instanceof Player shooter ->
          Optional.of(shooter);
      default -> Optional.empty();
    };
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onDamage(EntityDamageByEntityEvent event) {
    if (!(event.getEntity() instanceof Player victim) || !inWorld(victim)) {
      return;
    }
    var attacker = responsible(event.getDamager());
    var victimMember = runner.memberOf(victim.getUniqueId()).isPresent();
    if (attacker.isEmpty()) {
      if (victimMember) {
        tracker.hurt(victim.getUniqueId(), cause(event));
      }
      return;
    }
    var attackerMember = runner.memberOf(attacker.orElseThrow().getUniqueId()).isPresent();
    if (!victimMember && !attackerMember) {
      return;
    }
    // Members fight only members, alive, on other teams, and never with a sweep; the rules take
    // over from here, so the server's own damage is always cancelled.
    event.setCancelled(true);
    if (event.getCause() == EntityDamageEvent.DamageCause.ENTITY_SWEEP_ATTACK
        || !mayFight(attacker.orElseThrow(), victim)) {
      return;
    }
    var type = event.getDamager() instanceof Player ? AttackType.MELEE : AttackType.PROJECTILE;
    strike(new Strike(attacker.orElseThrow(), event.getDamager(), victim, type, event.getDamage()));
  }

  /**
   * One hit between members.
   *
   * @param attacker who swung or shot
   * @param source the attacker, or the projectile
   * @param victim who was hit
   * @param type melee or projectile
   * @param raw the server's own damage for a projectile; unused for melee
   */
  record Strike(Player attacker, Entity source, Player victim, AttackType type, double raw) {}

  /** Living members of a live match on different teams; nobody else hurts or is hurt by them. */
  private boolean mayFight(Player attacker, Player victim) {
    if (!runner.fighting(attacker.getUniqueId()) || !runner.fighting(victim.getUniqueId())) {
      return false;
    }
    Optional<TeamColor> a = runner.memberOf(attacker.getUniqueId()).flatMap(m -> m.team());
    Optional<TeamColor> v = runner.memberOf(victim.getUniqueId()).flatMap(m -> m.team());
    return !a.equals(v);
  }

  /** Applies the rules' damage and knockback for {@code strike}. */
  private void strike(Strike strike) {
    var victim = strike.victim();
    var damage =
        DamageFormula.finalDamage(hit(strike.type(), strike.attacker(), victim, strike.raw()));
    var landed =
        switch (HitWindow.resolve(damage, strike.type(), tracker.guard(victim))) {
          case HitWindow.Resolution.Blocked _ -> 0.0;
          case HitWindow.Resolution.Partial partial -> partial.extra();
          case HitWindow.Resolution.Full full -> {
            victim.setNoDamageTicks(CombatRules.MAX_NO_DAMAGE_TICKS);
            yield full.damage();
          }
        };
    if (landed <= 0) {
      return;
    }
    tracker.hit(victim, damage, Optional.of(strike.attacker().getUniqueId()), strike.type());
    knockback(strike);
    hooks.hurt().accept(victim);
    context.world().playSound(Places.at(victim), Sound.ENTITY_PLAYER_HURT, 1, 1);
    victim.setHealth(Math.max(0, victim.getHealth() - landed));
  }

  private void knockback(Strike strike) {
    var attacker = strike.attacker();
    var victim = strike.victim();
    var level = 0;
    if (strike.type().has(AttackType.Flag.MELEE)) {
      level =
          (attacker.isSprinting() ? 1 : 0)
              + KitFactory.enchantmentLevel(
                  attacker.getInventory().getItemInMainHand(), "knockback");
    }
    var params =
        Knockback.Params.hit(
            Places.vec(strike.source().getLocation()),
            Places.vec(Places.at(victim)),
            Places.vec(victim.getVelocity()),
            level);
    var knockback = Knockback.compute(params, context.random());
    if (strike.source() instanceof AbstractArrow arrow) {
      var bow = arrow.getWeapon();
      var punch = bow == null ? 0 : KitFactory.enchantmentLevel(bow, "punch");
      knockback = Knockback.finish(knockback.plus(Knockback.arrow(knockback, punch)));
    }
    victim.setVelocity(Places.vector(knockback));
    if (strike.type().has(AttackType.Flag.MELEE) && attacker.isSprinting()) {
      attacker.setSprinting(false);
      attacker.setVelocity(
          Places.vector(Knockback.sprintReset(Places.vec(attacker.getVelocity()))));
    }
  }

  /** The damage the rules compute for this hit, before the hit window. */
  static DamageFormula.Hit hit(AttackType type, Player attacker, Player victim, double raw) {
    var armor = KitFactory.armor(victim);
    if (type.has(AttackType.Flag.MELEE)) {
      var weapon = KitFactory.spec(attacker.getInventory().getItemInMainHand(), Optional.empty());
      return DamageFormula.Hit.melee(weapon, armor);
    }
    return DamageFormula.Hit.of(type, raw, armor);
  }

  private static AttackType cause(EntityDamageEvent event) {
    return switch (event.getCause()) {
      case FALL -> AttackType.FALL;
      case VOID -> AttackType.VOID;
      case FIRE, FIRE_TICK, CAMPFIRE -> AttackType.FIRE_TICK;
      case LAVA -> AttackType.LAVA;
      case DROWNING -> AttackType.DROWNED;
      case STARVATION -> AttackType.STARVATION;
      case SUFFOCATION -> AttackType.SUFFOCATION;
      case SUICIDE, KILL -> AttackType.SUICIDE;
      case ENTITY_ATTACK -> AttackType.MELEE;
      case PROJECTILE -> AttackType.PROJECTILE;
      case BLOCK_EXPLOSION, ENTITY_EXPLOSION -> AttackType.EXPLOSION;
      case FALLING_BLOCK -> AttackType.FALLING_BLOCK;
      case POISON -> AttackType.POISON;
      case LIGHTNING -> AttackType.LIGHTNING;
      default -> AttackType.UNKNOWN;
    };
  }

  /** Damage from the world (fall, fire, lava) is left to vanilla but remembered for attribution. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.MONITOR)
  void onWorldDamage(EntityDamageEvent event) {
    if (event instanceof EntityDamageByEntityEvent
        || !(event.getEntity() instanceof Player victim)
        || !inWorld(victim)
        || runner.memberOf(victim.getUniqueId()).isEmpty()) {
      return;
    }
    tracker.hurt(victim.getUniqueId(), cause(event));
  }

  /** Nothing hurts a member before the match starts: the lobby has no damage. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onLobbyDamage(EntityDamageEvent event) {
    if (event.getEntity() instanceof Player victim
        && inWorld(victim)
        && runner.waiting(victim.getUniqueId())) {
      event.setCancelled(true);
    }
  }

  /** The server never pushes a member on its own account; the rules did above. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onKnockback(EntityKnockbackEvent event) {
    if (event.getEntity() instanceof Player victim
        && inWorld(victim)
        && runner.memberOf(victim.getUniqueId()).isPresent()
        && (event.getCause() == EntityKnockbackEvent.Cause.ENTITY_ATTACK
            || event.getCause() == EntityKnockbackEvent.Cause.SWEEP_ATTACK)) {
      event.setCancelled(true);
    }
  }

  /** Search and Destroy turns hunger off: a member's food never drops. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onFood(FoodLevelChangeEvent event) {
    if (!(event.getEntity() instanceof Player player) || !inWorld(player)) {
      return;
    }
    if (runner.memberOf(player.getUniqueId()).isPresent()
        && !CombatRules.HUNGER
        && event.getFoodLevel() < player.getFoodLevel()) {
      event.setCancelled(true);
    }
  }

  /**
   * Steak never goes through the eating animation; it heals at once on right-click. Bukkit raises a
   * right-click into the air already cancelled (there is no block to use), so the handler reads
   * whether the item may be used instead of skipping cancelled events.
   */
  @EventHandler(priority = EventPriority.HIGH)
  void onSteak(PlayerInteractEvent event) {
    var player = event.getPlayer();
    var item = event.getItem();
    if (event.useItemInHand() == Event.Result.DENY
        || item == null
        || item.getType() != Material.COOKED_BEEF
        || !inWorld(player)
        || (event.getAction() != Action.RIGHT_CLICK_AIR
            && event.getAction() != Action.RIGHT_CLICK_BLOCK)
        || !runner.fighting(player.getUniqueId())) {
      return;
    }
    event.setUseItemInHand(Event.Result.DENY);
    eatSteak(player, item).ifPresent(refusal -> Texts.error(player, refusal));
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onConsume(PlayerItemConsumeEvent event) {
    var player = event.getPlayer();
    if (event.getItem().getType() == Material.COOKED_BEEF
        && inWorld(player)
        && runner.memberOf(player.getUniqueId()).isPresent()) {
      event.setCancelled(true);
    }
  }

  /** Heals {@code player} by one steak from {@code stack}, or says why not. */
  static Optional<ActionRefusal> eatSteak(Player player, ItemStack stack) {
    var attribute = player.getAttribute(Attribute.MAX_HEALTH);
    if (attribute == null) {
      throw new IllegalStateException("players always have max health");
    }
    var heal = CombatRules.steakHeal(player.getHealth(), attribute.getValue());
    if (heal.isEmpty()) {
      return Optional.of(ActionRefusal.FULL_HEALTH);
    }
    player.setHealth(Math.min(attribute.getValue(), player.getHealth() + heal.orElseThrow()));
    stack.subtract();
    return Optional.empty();
  }
}
