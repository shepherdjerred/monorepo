package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.spells.domain.Screening;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

/**
 * Asks the land-protection port before a spell changes a block or affects a creature. Spells act as
 * their caster: a spell may do in a claim exactly what the caster could do there by hand, and admin
 * regions refuse whatever their rules refuse.
 *
 * <p>Any effect on a creature (damage, fire, potions, knockback, freezing, trapping, silencing,
 * disarming, teleporting next to it) is harm. Harming a player asks {@link HarmTarget#PLAYER},
 * which needs PvP on both the caster's and the victim's land; harming a pet, animal, villager or
 * NPC asks {@link HarmTarget#PASSIVE}. Hostile monsters are not protected by the port, but a spell
 * still leaves alone monsters standing on land where its caster may not build, so mob farms and
 * curing cells inside claims are safe.
 */
public final class Guard {

  private final Protection protection;

  public Guard(Protection protection) {
    this.protection = protection;
  }

  /** Why {@code caster} may not do {@code action} at {@code where}, or empty when allowed. */
  public Optional<Component> denial(Player caster, ProtectedAction action, Location where) {
    return reason(protection.check(caster.getUniqueId(), action, where));
  }

  /** Why {@code caster}'s spell may not affect {@code target}, or empty when allowed. */
  public Optional<Component> harmDenial(Player caster, LivingEntity target) {
    Entity body = caster;
    return harmDenial(caster.getUniqueId(), body.getLocation(), target);
  }

  /**
   * Why a spell cast by {@code caster} (standing at {@code casterAt}, possibly offline, as for a
   * Ward) may not affect {@code target}.
   */
  public Optional<Component> harmDenial(UUID caster, Location casterAt, LivingEntity target) {
    var victimAt = target.getLocation();
    if (isHostile(target)) {
      return reason(protection.check(caster, ProtectedAction.BUILD, victimAt));
    }
    var kind = target instanceof Player ? HarmTarget.PLAYER : HarmTarget.PASSIVE;
    return reason(protection.checkHarm(caster, casterAt, kind, victimAt));
  }

  /** Hostile monsters: never protected creatures, only protected land. */
  static boolean isHostile(Entity entity) {
    return entity instanceof Enemy && !(entity instanceof Player);
  }

  /** {@code blocks} split by whether {@code caster} may do {@code action} to each. */
  public Screening.Screened<Block, Component> blocks(
      Player caster, ProtectedAction action, List<Block> blocks) {
    return Screening.screen(blocks, block -> denial(caster, action, block.getLocation()));
  }

  /** {@code creatures} split by whether {@code caster}'s spell may affect each. */
  public <T extends LivingEntity> Screening.Screened<T, Component> creatures(
      Player caster, List<T> creatures) {
    return Screening.screen(creatures, creature -> harmDenial(caster, creature));
  }

  private static Optional<Component> reason(Decision decision) {
    return switch (decision) {
      case Decision.Allowed() -> Optional.empty();
      case Decision.Denied(var why) -> Optional.of(why);
    };
  }
}
