package com.shepherdjerred.thestorm.spells.adapter.paper;

import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.util.Vector;
import org.jspecify.annotations.Nullable;

/**
 * The one way a spell affects a creature. Every blow is checked with {@link Guard#harmDenial} at
 * the moment it lands; if it carries damage and the damage event is cancelled (by the towns
 * module's PvP listener, a god-mode plugin, anything), none of its riders (fire, knockback,
 * potions, frost, silencing, disarming, trapping) apply either. Affecting any creature ends the
 * caster's Stealth.
 */
public final class Harm implements Listener {

  private final Guard guard;
  private final SpellState state;
  private final InstantSource time;
  private @Nullable LivingEntity hurting;
  private boolean landed;

  /**
   * Deals a blow's damage and says whether it landed (was not cancelled). The server deals magic
   * damage caused by the caster; tests stand in for it.
   */
  @FunctionalInterface
  interface Hurter {
    boolean hurt(LivingEntity target, double amount, Player caster);
  }

  private final Optional<Hurter> hurter;

  public Harm(Guard guard, SpellState state, InstantSource time) {
    this(guard, state, time, Optional.empty());
  }

  Harm(Guard guard, SpellState state, InstantSource time, Optional<Hurter> hurter) {
    this.guard = guard;
    this.state = state;
    this.time = time;
    this.hurter = hurter;
  }

  /**
   * One spell's effect on one creature. Build it with {@link #none()} and the {@code with...}
   * methods.
   *
   * @param damage magic damage, dealt first
   * @param fireTicks how long the creature burns (it never burns for less than it already does)
   * @param velocity a new velocity
   * @param potions effects to add
   * @param freezeTicks powder-snow freezing to set
   * @param extras anything else the spell does to the creature (silence, disarm, entomb)
   */
  public record Blow(
      double damage,
      int fireTicks,
      Optional<Vector> velocity,
      List<PotionEffect> potions,
      int freezeTicks,
      List<Consumer<LivingEntity>> extras) {

    public Blow {
      potions = List.copyOf(potions);
      extras = List.copyOf(extras);
    }

    public static Blow none() {
      return new Blow(0, 0, Optional.empty(), List.of(), 0, List.of());
    }

    public Blow withDamage(double amount) {
      return new Blow(amount, fireTicks, velocity, potions, freezeTicks, extras);
    }

    public Blow withFire(int ticks) {
      return new Blow(damage, ticks, velocity, potions, freezeTicks, extras);
    }

    public Blow withVelocity(Vector push) {
      return new Blow(damage, fireTicks, Optional.of(push), potions, freezeTicks, extras);
    }

    public Blow withPotion(PotionEffectType type, int ticks, int amplifier) {
      var more = new ArrayList<>(potions);
      more.add(new PotionEffect(type, ticks, amplifier, false, true, true));
      return new Blow(damage, fireTicks, velocity, more, freezeTicks, extras);
    }

    public Blow withFreeze(int ticks) {
      return new Blow(damage, fireTicks, velocity, potions, ticks, extras);
    }

    public Blow then(Consumer<LivingEntity> extra) {
      var more = new ArrayList<>(extras);
      more.add(extra);
      return new Blow(damage, fireTicks, velocity, potions, freezeTicks, more);
    }
  }

  /** Why {@code caster} may not affect {@code target} now, or empty. */
  public Optional<Component> denial(Player caster, LivingEntity target) {
    return guard.harmDenial(caster, target);
  }

  /**
   * Lands {@code blow} on {@code target} if the caster may harm it and its damage (if any) is not
   * cancelled. Returns whether it landed.
   */
  public boolean strike(Player caster, LivingEntity target, Blow blow) {
    breakStealth(caster);
    if (guard.harmDenial(caster, target).isPresent()) {
      return false;
    }
    if (blow.damage() > 0 && !hurt(target, blow.damage(), caster)) {
      return false;
    }
    if (blow.fireTicks() > 0) {
      target.setFireTicks(Math.max(target.getFireTicks(), blow.fireTicks()));
    }
    blow.velocity().ifPresent(target::setVelocity);
    blow.potions().forEach(target::addPotionEffect);
    if (blow.freezeTicks() > 0) {
      target.setFreezeTicks(Math.max(target.getFreezeTicks(), blow.freezeTicks()));
    }
    blow.extras().forEach(extra -> extra.accept(target));
    return true;
  }

  /** Ends {@code caster}'s Stealth: they just acted on a creature. */
  public void breakStealth(Player caster) {
    if (state.stealth().stop(caster.getUniqueId(), time.instant())) {
      caster.removePotionEffect(PotionEffectType.INVISIBILITY);
      caster.sendActionBar(Component.text("Your stealth breaks."));
    }
  }

  private boolean hurt(LivingEntity target, double amount, Player caster) {
    return hurter.isPresent()
        ? hurter.get().hurt(target, amount, caster)
        : magic(target, amount, caster);
  }

  /**
   * Magic damage caused by {@code caster}, so the server (and the towns module's PvP listener) sees
   * who hurt whom; true when the damage event was not cancelled.
   */
  private boolean magic(LivingEntity target, double amount, Player caster) {
    var source =
        DamageSource.builder(DamageType.MAGIC)
            .withCausingEntity(caster)
            .withDirectEntity(caster)
            .build();
    hurting = target;
    landed = false;
    try {
      target.damage(amount, source);
      return landed;
    } finally {
      hurting = null;
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onDamage(EntityDamageEvent event) {
    if (event.getEntity().equals(hurting)) {
      landed = true;
    }
  }
}
