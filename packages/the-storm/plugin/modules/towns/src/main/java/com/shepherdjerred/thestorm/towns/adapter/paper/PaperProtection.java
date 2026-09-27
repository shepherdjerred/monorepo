package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Actor;
import com.shepherdjerred.thestorm.towns.domain.protection.ProtectionEngine;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.protection.Verdict;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.Server;

/**
 * The {@link Protection} port other modules call: the same engine and land as the listeners. An
 * offline player never has bypass. Main thread only, like the state it reads: a call from another
 * thread is a bug in the caller and throws.
 */
final class PaperProtection implements Protection {

  private final Server server;
  private final Guard guard;
  private final ProtectionEngine engine;
  private final Rendering rendering;

  /**
   * What the port renders with.
   *
   * @param kinds block subjects
   * @param notices denial messages
   */
  record Rendering(BlockKinds kinds, Notices notices) {}

  PaperProtection(Server server, Guard guard, ProtectionEngine engine, Rendering rendering) {
    this.server = server;
    this.guard = guard;
    this.engine = engine;
    this.rendering = rendering;
  }

  @Override
  public Decision check(UUID player, ProtectedAction action, Location location) {
    requireMainThread();
    var act = new Act(actionOf(action), subjectOf(action, location));
    return decision(engine.decide(actor(player), act, guard.land(location)));
  }

  /**
   * Players: PvP must be on where the attacker stands and where the victim stands. Everything else
   * passive: the victim's land must let the attacker hurt animals; a pet's owner is the calling
   * module's concern, since the port is not told who owns the creature.
   */
  @Override
  public Decision checkHarm(
      UUID attacker, Location attackerAt, HarmTarget target, Location victimAt) {
    requireMainThread();
    var actor = actor(attacker);
    return decision(
        switch (target) {
          case PLAYER -> engine.decidePvp(actor, guard.land(attackerAt), guard.land(victimAt));
          case PASSIVE ->
              engine.decide(
                  actor, new Act(Action.DAMAGE_ENTITY, Subject.ANIMAL), guard.land(victimAt));
        });
  }

  @Override
  public boolean sameLand(Location a, Location b) {
    requireMainThread();
    return guard.land(a).sameOwnerAs(guard.land(b));
  }

  private void requireMainThread() {
    if (!server.isPrimaryThread()) {
      throw new IllegalStateException(
          "Protection is main-thread only; it was called from " + Thread.currentThread().getName());
    }
  }

  private Actor actor(UUID player) {
    var online = server.getPlayer(player);
    return new Actor(player, online != null && online.hasPermission(Guard.BYPASS_PERMISSION));
  }

  private Decision decision(Verdict verdict) {
    return switch (verdict) {
      case Verdict.Allow _ -> Decision.allowed();
      case Verdict.Deny(var denial) -> new Decision.Denied(rendering.notices().render(denial));
    };
  }

  static Action actionOf(ProtectedAction action) {
    return switch (action) {
      case BUILD -> Action.BUILD;
      case BREAK -> Action.BREAK;
      case INTERACT -> Action.INTERACT;
      case OPEN_CONTAINER -> Action.OPEN_CONTAINER;
      case USE_REDSTONE -> Action.USE_REDSTONE;
      case DAMAGE_ENTITY -> Action.DAMAGE_ENTITY;
      case INTERACT_ENTITY -> Action.INTERACT_ENTITY;
      case PLACE_ENTITY -> Action.PLACE_ENTITY;
      case TELEPORT_INTO -> Action.TELEPORT_INTO;
      case SET_HOME -> Action.SET_HOME;
    };
  }

  private Subject subjectOf(ProtectedAction action, Location location) {
    return switch (action) {
      case BUILD, BREAK, INTERACT, OPEN_CONTAINER, USE_REDSTONE ->
          rendering.kinds().subject(location.getBlock().getType());
      case DAMAGE_ENTITY, INTERACT_ENTITY, PLACE_ENTITY -> Subject.ENTITY;
      case TELEPORT_INTO, SET_HOME -> Subject.LOCATION;
    };
  }
}
