package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.spells.domain.Screening;
import java.util.List;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

/**
 * Asks the land-protection port before a spell changes a block or affects a creature. Spells act as
 * their caster: a spell may do in a claim exactly what the caster could do there by hand, and admin
 * regions refuse whatever their rules refuse.
 *
 * <p>Hostile monsters are fair game everywhere, as they are for a sword. Every other creature
 * (animals, villagers, NPCs, players) is checked with {@link ProtectedAction#DAMAGE_ENTITY} at its
 * position, which for a player is the claim's PvP decision.
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
    if (target instanceof Enemy && !(target instanceof Player)) {
      return Optional.empty();
    }
    return denial(caster, ProtectedAction.DAMAGE_ENTITY, target.getLocation());
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
