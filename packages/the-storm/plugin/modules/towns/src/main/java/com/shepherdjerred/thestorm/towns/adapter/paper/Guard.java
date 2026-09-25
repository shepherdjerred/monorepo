package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Actor;
import com.shepherdjerred.thestorm.towns.domain.protection.Denial;
import com.shepherdjerred.thestorm.towns.domain.protection.ProtectionEngine;
import com.shepherdjerred.thestorm.towns.domain.protection.Verdict;
import com.shepherdjerred.thestorm.towns.domain.protection.Victim;
import com.shepherdjerred.thestorm.towns.domain.world.WorldEffect;
import com.shepherdjerred.thestorm.towns.domain.world.WorldRules;
import java.util.List;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockState;
import org.bukkit.damage.DamageSource;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * The one place listeners ask: resolves Paper positions to land, asks the domain, and tells the
 * player when they are refused. Main thread only.
 */
final class Guard {

  static final String BYPASS_PERMISSION = "thestorm.towns.bypass";

  private final TownsState state;
  private final ProtectionEngine engine;
  private final Notices notices;
  private final Culprits culprits;

  Guard(TownsState state, ProtectionEngine engine, Notices notices, Culprits culprits) {
    this.state = state;
    this.engine = engine;
    this.notices = notices;
    this.culprits = culprits;
  }

  Land land(Block block) {
    return state.landAt(block.getWorld().getName(), block.getX(), block.getY(), block.getZ());
  }

  Land land(BlockState block) {
    return state.landAt(block.getWorld().getName(), block.getX(), block.getY(), block.getZ());
  }

  Land land(Location location) {
    return state.landAt(
        world(location).getName(),
        location.getBlockX(),
        location.getBlockY(),
        location.getBlockZ());
  }

  Land land(Entity entity) {
    return land(entity.getLocation());
  }

  /**
   * Where {@code entity} is. Takes an {@link Entity} so a player resolves to its live position,
   * never {@code OfflinePlayer}'s nullable last-known one.
   */
  static Location position(Entity entity) {
    return entity.getLocation();
  }

  static World world(Location location) {
    var world = location.getWorld();
    if (world == null) {
      throw new IllegalArgumentException("location has no world: " + location);
    }
    return world;
  }

  static Actor actor(Player player) {
    return Culprit.of(player).actor();
  }

  /** The player behind {@code entity}, if any (see {@link Culprits}). */
  Optional<Culprit> culprit(@Nullable Entity entity) {
    return culprits.behind(entity);
  }

  Optional<Culprit> culprit(DamageSource source) {
    return culprits.behind(source);
  }

  /**
   * The players answerable for {@code entity}: everyone controlling it (riders, lead holders), else
   * the player behind it (see {@link Culprits#controllers}). Empty when nobody is.
   */
  List<Culprit> controllers(@Nullable Entity entity) {
    return entity == null ? List.of() : culprits.controllers(entity);
  }

  /** True when every one of {@code culprits} may do {@code act} on {@code land}; tells nobody. */
  boolean allPermitQuietly(List<Culprit> culprits, Act act, Land land) {
    for (var culprit : culprits) {
      if (!permitsQuietly(culprit, act, land)) {
        return false;
      }
    }
    return true;
  }

  /** Where {@code entity}'s effect came from, a potion cloud's recorded origin included. */
  Location origin(Entity entity) {
    return culprits.origin(entity);
  }

  Culprits culprits() {
    return culprits;
  }

  Verdict verdict(Player player, Act act, Land land) {
    return engine.decide(actor(player), act, land);
  }

  /** True when {@code player} may do {@code act} on {@code land}; tells them if not. */
  boolean permits(Player player, Act act, Land land) {
    return tell(player, verdict(player, act, land));
  }

  /** As {@link #permits}, without telling the player: for trampling, stepping and knockback. */
  boolean permitsQuietly(Player player, Act act, Land land) {
    return verdict(player, act, land).isAllowed();
  }

  /** True when {@code culprit} may do {@code act} on {@code land}; tells them if online. */
  boolean permits(Culprit culprit, Act act, Land land) {
    return tell(culprit, engine.decide(culprit.actor(), act, land));
  }

  /** As {@link #permitsQuietly(Culprit, Act, Land)} for an actor built once for many checks. */
  boolean permitsQuietly(Actor actor, Act act, Land land) {
    return engine.decide(actor, act, land).isAllowed();
  }

  boolean permitsQuietly(Culprit culprit, Act act, Land land) {
    return engine.decide(culprit.actor(), act, land).isAllowed();
  }

  /**
   * True when {@code attacker} may hurt, push or pull {@code victim} (see {@link
   * ProtectionEngine#decideHarm}). Tells the attacker when refused if {@code tell}.
   */
  boolean permitsHarm(Player attacker, Entity victim, boolean tell) {
    return permitsHarm(Culprit.of(attacker), victim, tell);
  }

  boolean permitsHarm(Culprit attacker, Entity victim, boolean tell) {
    var verdict =
        engine.decideHarm(
            attacker.actor(),
            land(attacker.from()),
            EntityKinds.victim(victim, attacker.id()),
            land(victim));
    return tell ? tell(attacker, verdict) : verdict.isAllowed();
  }

  /**
   * True when {@code player} may use {@code entity}: their own pets and unprotected entities
   * always, anything else as the land allows. Tells them when refused.
   */
  boolean permitsUse(Player player, Entity entity, Act act) {
    if (EntityKinds.isPetOf(entity, player.getUniqueId())) {
      return true;
    }
    return permits(player, act, land(entity));
  }

  /**
   * True when harm nobody can be blamed for, coming from {@code origin}, may reach a player on
   * {@code victimLand} (see {@link ProtectionEngine#allowsUntracedHarm}).
   */
  boolean allowsUntracedHarm(Land origin, Land victimLand) {
    return engine.allowsUntracedHarm(origin, victimLand);
  }

  /** True, telling the player, when {@code entity} is a pet someone else tamed. */
  boolean refuseOthersPet(Player player, Entity entity) {
    if (EntityKinds.victim(entity, player.getUniqueId()) instanceof Victim.OthersPet) {
      notices.denied(player, new Denial.NotYourPet());
      return true;
    }
    return false;
  }

  static boolean flows(WorldEffect effect, Land from, Land to) {
    return WorldRules.allows(effect, from, to);
  }

  boolean flows(WorldEffect effect, Block from, Block to) {
    return WorldRules.allows(effect, land(from), land(to));
  }

  void forget(Player player) {
    notices.forget(player);
  }

  private boolean tell(Culprit culprit, Verdict verdict) {
    var player = culprit.online();
    return player == null ? verdict.isAllowed() : tell(player, verdict);
  }

  private boolean tell(Player player, Verdict verdict) {
    return switch (verdict) {
      case Verdict.Allow _ -> true;
      case Verdict.Deny(var denial) -> {
        notices.denied(player, denial);
        yield false;
      }
    };
  }
}
