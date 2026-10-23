package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwf.app.view.WeaponProfile;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCombat;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.CombatRules;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.combat.HitWindow;
import com.shepherdjerred.thestorm.rwf.domain.combat.Knockback;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import io.papermc.paper.event.entity.EntityKnockbackEvent;
import io.papermc.paper.event.entity.EntityPushedByEntityAttackEvent;
import java.util.Optional;
import java.util.random.RandomGenerator;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.AbstractArrow;
import org.bukkit.entity.Arrow;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Firework;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.SpectralArrow;
import org.bukkit.entity.Trident;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityPotionEffectEvent;
import org.bukkit.event.entity.EntityShootBowEvent;
import org.bukkit.event.entity.FoodLevelChangeEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerItemConsumeEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerVelocityEvent;
import org.bukkit.inventory.ItemStack;

/**
 * Red Warfare combat, only inside the rwf world and only between living members of a live match.
 * Legacy damage events are cancelled and their hits applied here instead: damage from {@link
 * DamageFormula} through {@link HitWindow}, knockback from {@link Knockback} with the attacker's
 * sprint reset, no sweep attacks, no hunger, instant steaks. Everything else (golden apples, fall
 * damage, fire) keeps native mitigation through the same hit window. Modern weapons complete native
 * damage events with an authoritative final amount through {@link PaperNativeDamage}, preserving
 * piercing, ammunition effects, absorption and successful item callbacks.
 */
final class CombatListener implements Listener {

  private final MatchRunner runner;
  private final CombatTracker tracker;
  private final PaperContext context;
  private final ServerHooks hooks;
  private final Sacrifices sacrifices;

  CombatListener(
      MatchRunner runner, CombatTracker tracker, PaperContext context, ServerHooks hooks) {
    this.runner = runner;
    this.tracker = tracker;
    this.context = context;
    this.hooks = hooks;
    this.sacrifices = new Sacrifices(runner, context, tracker);
  }

  private boolean inWorld(Entity entity) {
    return context.ours(entity.getWorld());
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
    var confirmed = confirmedStrike(event, victim);
    if (confirmed.isEmpty()) return;
    var strike = confirmed.orElseThrow();
    if (PaperNativeDamage.blocked(event) && runner.powers().expansion().shield(strike)) return;
    if (strike.type().has(AttackType.Flag.PROJECTILE))
      runner.powers().expansion().projectileFacts(strike);
    if (nativeWeapon(strike)) {
      nativeStrike(event, strike);
    } else {
      event.setCancelled(true);
      strike(strike);
    }
  }

  private Optional<Strike> confirmedStrike(EntityDamageByEntityEvent event, Player victim) {
    var attacker = responsible(event.getDamager());
    var victimMember = runner.memberOf(victim.getUniqueId()).isPresent();
    if (attacker.isEmpty()) {
      if (victimMember) {
        tracker.hurt(victim, cause(event), event.getFinalDamage());
      }
      return Optional.empty();
    }
    var attackerMember = runner.memberOf(attacker.orElseThrow().getUniqueId()).isPresent();
    if (!victimMember && !attackerMember) {
      return Optional.empty();
    }
    // Members fight only living members on other teams, and never with a sweep.
    if (event.getCause() == EntityDamageEvent.DamageCause.ENTITY_SWEEP_ATTACK
        || !mayFight(attacker.orElseThrow(), victim)) {
      event.setCancelled(true);
      return Optional.empty();
    }
    var type = event.getDamager() instanceof Player ? AttackType.MELEE : AttackType.PROJECTILE;
    return Optional.of(
        new Strike(attacker.orElseThrow(), event.getDamager(), victim, type, event.getDamage()));
  }

  private static boolean nativeWeapon(Strike strike) {
    if (strike.source() instanceof Trident) {
      return true;
    }
    if (strike.source() instanceof AbstractArrow arrow && arrow.isShotFromCrossbow()) {
      return true;
    }
    if (strike.source() instanceof SpectralArrow) {
      return true;
    }
    if (strike.source() instanceof Arrow arrow
        && arrow.getItemStack().getType() == Material.TIPPED_ARROW) {
      return true;
    }
    return strike.source() instanceof Player
        && WeaponProfile.of(
                KitFactory.spec(
                    strike.attacker().getInventory().getItemInMainHand(), Optional.empty()))
            .nativeMelee();
  }

  /** Native completion owns health, absorption, knockback and successful item callbacks. */
  private void nativeStrike(EntityDamageByEntityEvent event, Strike strike) {
    if (PaperNativeDamage.blocked(event)) {
      return;
    }
    var victim = strike.victim();
    var damage = runner.kits().damage(strike.type(), strike.attacker(), victim, strike.raw());
    var landed =
        switch (HitWindow.resolve(damage, strike.type(), tracker.guard(victim))) {
          case HitWindow.Resolution.Blocked _ -> 0.0;
          case HitWindow.Resolution.Partial partial -> partial.extra();
          case HitWindow.Resolution.Full full -> full.damage();
        };
    if (landed <= 0
        || sacrifices.shield(
            Optional.of(strike.attacker()),
            victim,
            hit(strike.type(), strike.attacker(), victim, strike.raw()))) {
      event.setCancelled(true);
      return;
    }
    PaperNativeDamage.apply(event, landed, victim.getAbsorptionAmount());
    tracker.hit(victim, damage, Optional.of(strike.attacker().getUniqueId()), strike.type());
    runner.damaged(victim, Optional.of(strike.attacker().getUniqueId()), landed, strike.type());
    runner
        .kits()
        .hit(
            strike.attacker(),
            victim,
            strike.type(),
            new KitBridge.Landed(landed, Math.max(0, victim.getHealth() - event.getFinalDamage())));
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
    var damage = runner.kits().damage(strike.type(), strike.attacker(), victim, strike.raw());
    var landed =
        switch (HitWindow.resolve(damage, strike.type(), tracker.guard(victim))) {
          case HitWindow.Resolution.Blocked _ -> 0.0;
          case HitWindow.Resolution.Partial partial -> partial.extra();
          case HitWindow.Resolution.Full full -> {
            victim.setNoDamageTicks(
                victim.getMaximumNoDamageTicks() == 0 ? 0 : CombatRules.MAX_NO_DAMAGE_TICKS);
            yield full.damage();
          }
        };
    if (landed <= 0) {
      return;
    }
    tracker.hit(victim, damage, Optional.of(strike.attacker().getUniqueId()), strike.type());
    knockback(strike);
    hooks.hurt().accept(victim);
    victim.getWorld().playSound(Places.at(victim), Sound.ENTITY_PLAYER_HURT, 1, 1);
    if (sacrifices.shield(
        Optional.of(strike.attacker()),
        victim,
        hit(strike.type(), strike.attacker(), victim, strike.raw()))) {
      return;
    }
    runner.damaged(victim, Optional.of(strike.attacker().getUniqueId()), landed, strike.type());
    Harm.take(victim, landed);
    runner.kits().hit(strike.attacker(), victim, strike.type(), landed);
  }

  private void knockback(Strike strike) {
    var victim = strike.victim();
    var knockback = push(strike.source(), strike.attacker(), victim, context.random());
    victim.setVelocity(KnockbackShare.landing(runner, victim, Places.vector(knockback)));
    if (strike.type().has(AttackType.Flag.MELEE)) {
      sprintReset(strike.attacker());
    }
  }

  /**
   * The knockback {@code attacker}'s hit through {@code source} (themselves for melee, or their
   * projectile) gives {@code victim}: a level for sprinting and each of the weapon's Knockback in
   * melee, the bow's Punch for an arrow.
   */
  static Vec3 push(Entity source, Player attacker, LivingEntity victim, RandomGenerator random) {
    var level = 0;
    if (source instanceof Player) {
      level =
          (attacker.isSprinting() ? 1 : 0)
              + KitFactory.enchantmentLevel(
                  attacker.getInventory().getItemInMainHand(), "knockback");
    }
    var params =
        Knockback.Params.hit(
            Places.vec(source.getLocation()),
            Places.vec(Places.at(victim)),
            Places.vec(victim.getVelocity()),
            level);
    var knockback = Knockback.compute(params, random);
    if (source instanceof AbstractArrow arrow) {
      var bow = arrow.getWeapon();
      var punch = bow == null ? 0 : KitFactory.enchantmentLevel(bow, "punch");
      knockback = Knockback.finish(knockback.plus(Knockback.arrow(knockback, punch)));
    }
    return knockback;
  }

  /** A sprinting attacker who lands a melee hit stops sprinting and slows. */
  static void sprintReset(Player attacker) {
    if (attacker.isSprinting()) {
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
      if (WeaponProfile.of(weapon).nativeMelee()) {
        // Native raw damage already includes charge, enchantments and the mace's fall bonus.
        // Keeping the weapon absent prevents the legacy Sharpness formula applying it twice.
        return DamageFormula.Hit.of(type, raw, armor);
      }
      var melee = DamageFormula.Hit.melee(weapon, armor);
      var weakness = attacker.getPotionEffect(org.bukkit.potion.PotionEffectType.WEAKNESS);
      return weakness == null
          ? melee
          : melee.withBase(Math.max(0, melee.baseDamage() - 4 * (weakness.getAmplifier() + 1)));
    }
    return DamageFormula.Hit.of(type, raw, armor);
  }

  static AttackType cause(EntityDamageEvent event) {
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

  /**
   * Every potion effect a fighter gains (a golden apple, the poison, a kit's) becomes a recording
   * row through the match's hooks.
   */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.MONITOR)
  void onEffect(EntityPotionEffectEvent event) {
    var effect = event.getNewEffect();
    if (effect == null
        || !(event.getEntity() instanceof Player player)
        || !runner.fighting(player.getUniqueId())) {
      return;
    }
    runner
        .memberOf(player.getUniqueId())
        .ifPresent(
            member ->
                runner
                    .hooks()
                    .effectApplied(
                        member.id(),
                        effect.getType().getKey().getKey(),
                        effect.getAmplifier(),
                        // A kit's effect for the rest of the match is infinite; the row keeps the
                        // longest duration it can hold.
                        effect.isInfinite() ? Integer.MAX_VALUE : effect.getDuration()));
  }

  /** Damage from the world (fall, fire, lava) is left to vanilla but remembered for attribution. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onWorldHitWindow(EntityDamageEvent event) {
    if (event instanceof EntityDamageByEntityEvent
        || !(event.getEntity() instanceof Player victim)
        || !inWorld(victim)
        || !runner.fighting(victim.getUniqueId())
        || victim.getMaximumNoDamageTicks() != 0) {
      return;
    }
    var amount = PaperNativeDamage.beforeAbsorption(event);
    var attack = cause(event);
    if (attack.equals(AttackType.FALL) && runner.powers().noFall(victim.getUniqueId())) {
      return;
    }
    var landed =
        switch (HitWindow.resolve(amount, attack, tracker.guard(victim))) {
          case HitWindow.Resolution.Blocked _ -> 0.0;
          case HitWindow.Resolution.Partial partial -> partial.extra();
          case HitWindow.Resolution.Full full -> full.damage();
        };
    if (landed <= 0) {
      event.setCancelled(true);
      return;
    }
    PaperNativeDamage.apply(event, landed, victim.getAbsorptionAmount());
    tracker.hit(victim, amount, Optional.empty(), attack);
  }

  /** Damage from the world is remembered after native mitigation and the shared hit window. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.MONITOR)
  void onWorldDamage(EntityDamageEvent event) {
    if (event instanceof EntityDamageByEntityEvent
        || !(event.getEntity() instanceof Player victim)
        || !inWorld(victim)
        || runner.memberOf(victim.getUniqueId()).isEmpty()) {
      return;
    }
    tracker.hurt(victim, cause(event), event.getFinalDamage());
    runner.damaged(victim, Optional.empty(), event.getFinalDamage(), cause(event));
    runner.kits().hurt(victim, cause(event), event.getFinalDamage());
  }

  /** A Grappler's landing, or anyone a kit spared a fall, takes no fall damage. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onSparedFall(EntityDamageEvent event) {
    if (event.getCause() == EntityDamageEvent.DamageCause.FALL
        && event.getEntity() instanceof Player victim
        && inWorld(victim)
        && runner.powers().noFall(victim.getUniqueId())) {
      event.setCancelled(true);
    }
  }

  /**
   * A kit that may not sprint (the Juggernaut) that the server sees sprinting is put back where it
   * stands on every move, as Red Warfare's {@code onSprintToggle} did; its client is kept from
   * sprinting by the food level it is shown (see {@code KitPowers}).
   */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onSprintMove(PlayerMoveEvent event) {
    var player = event.getPlayer();
    if (player.isSprinting()
        && inWorld(player)
        && runner.fighting(player.getUniqueId())
        && runner
            .kits()
            .side(player.getUniqueId())
            .filter(s -> !KitCombat.maySprint(s.kit()))
            .isPresent()) {
      player.eject();
      player.leaveVehicle();
      player.teleport(Places.at(player));
    }
  }

  /** The end screen's fireworks are for show: they hurt nobody in the match's worlds. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onFireworkDamage(EntityDamageByEntityEvent event) {
    if (event.getDamager() instanceof Firework && inWorld(event.getEntity())) {
      event.setCancelled(true);
    }
  }

  /**
   * Every push a kit's holder takes is scaled by its knockback share (the Juggernaut's 0.8), as Red
   * Warfare's {@code PlayerVelocityEvent} handler scaled it, whatever pushed them. A bot's velocity
   * events are its own steering; its pushes are scaled where they land ({@link KnockbackShare}).
   */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onVelocity(PlayerVelocityEvent event) {
    var player = event.getPlayer();
    if (!inWorld(player)
        || !runner.fighting(player.getUniqueId())
        || KnockbackShare.steered(runner, player.getUniqueId())) {
      return;
    }
    runner
        .kits()
        .side(player.getUniqueId())
        .map(side -> KitCombat.knockback(side.kit()))
        .ifPresent(scale -> event.setVelocity(event.getVelocity().multiply(scale)));
  }

  /** Nothing hurts a member before the match goes live: the lobby, preview and freeze. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onLobbyDamage(EntityDamageEvent event) {
    if (event.getEntity() instanceof Player victim
        && inWorld(victim)
        && runner.waiting(victim.getUniqueId())) {
      event.setCancelled(true);
    }
  }

  /** A push the server lands on a bot itself, such as a blast's, takes the bot's share. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGHEST)
  void onBotKnockback(EntityKnockbackEvent event) {
    if (inWorld(event.getEntity())) {
      event.setKnockback(KnockbackShare.landing(runner, event.getEntity(), event.getKnockback()));
    }
  }

  /** The server never pushes a member on its own account; the rules did above. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onKnockback(EntityKnockbackEvent event) {
    if (event.getEntity() instanceof Player victim
        && inWorld(victim)
        && runner.memberOf(victim.getUniqueId()).isPresent()
        && !nativePush(event, victim)
        && (event.getCause() == EntityKnockbackEvent.Cause.ENTITY_ATTACK
            || event.getCause() == EntityKnockbackEvent.Cause.SWEEP_ATTACK)) {
      event.setCancelled(true);
    }
  }

  private boolean nativePush(EntityKnockbackEvent event, Player victim) {
    if (!(event instanceof EntityPushedByEntityAttackEvent pushed)) {
      return false;
    }
    var source = pushed.getPushedBy();
    var attacker = responsible(source);
    if (attacker.isEmpty() || !mayFight(attacker.orElseThrow(), victim)) {
      return false;
    }
    return nativeWeapon(
        new Strike(
            attacker.orElseThrow(),
            source,
            victim,
            source instanceof Player ? AttackType.MELEE : AttackType.PROJECTILE,
            0));
  }

  /** A fighter's arrow counts towards their shots, for the match statistics. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.MONITOR)
  void onShoot(EntityShootBowEvent event) {
    if (event.getEntity() instanceof Player shooter && inWorld(shooter)) {
      runner.shot(shooter, event.getProjectile());
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
    eatSteak(player, item)
        .ifPresentOrElse(refusal -> Texts.error(player, refusal), () -> runner.ateSteak(player));
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
    // Red Warfare's EventManager: the eat sound at volume 1.4 and pitch 0.
    player.getWorld().playSound(Places.at(player), Sound.ENTITY_GENERIC_EAT, 1.4f, 0f);
    return Optional.empty();
  }
}
