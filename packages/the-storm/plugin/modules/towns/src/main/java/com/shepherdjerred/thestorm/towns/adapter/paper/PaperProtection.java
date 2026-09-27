package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Actor;
import com.shepherdjerred.thestorm.towns.domain.protection.Denial;
import com.shepherdjerred.thestorm.towns.domain.protection.ProtectionEngine;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.protection.Verdict;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.bukkit.util.Vector;

/**
 * The {@link Protection} port other modules call: the same engine, land and locks as the listeners.
 * An offline player never has bypass. Main thread only, like the state it reads: a call from
 * another thread is a bug in the caller and throws.
 */
final class PaperProtection implements Protection {

  /** How far past a player's box a harm aimed at them still counts as aimed at them. */
  private static final double VICTIM_SLACK = 0.1;

  private final Server server;
  private final Guard guard;
  private final LockGuard locks;
  private final Rendering rendering;

  /**
   * What the port renders with.
   *
   * @param kinds block subjects
   * @param notices denial messages
   */
  record Rendering(BlockKinds kinds, Notices notices) {}

  PaperProtection(Server server, Guard guard, LockGuard locks, Rendering rendering) {
    this.server = server;
    this.guard = guard;
    this.locks = locks;
    this.rendering = rendering;
  }

  /**
   * The land's answer; for opening or breaking a container, its lock's answer too, so a module that
   * opens containers for players (a shop, a spell) never opens a locked one for someone else.
   */
  @Override
  public Decision check(UUID player, ProtectedAction action, Location location) {
    requireMainThread();
    var actor = actor(player);
    var act = new Act(actionOf(action), subjectOf(action, location));
    var land = guard.land(location);
    var verdict =
        action == ProtectedAction.OPEN_CONTAINER
                && rendering.kinds().isLockable(location.getBlock().getType())
                && land instanceof Land.TownLand
                && LockGuard.container(location.getBlock()).stream()
                    .anyMatch(block -> locks.lockOf(block) != null)
            ? Verdict.allow()
            : engine().decide(actor, act, land);
    if (verdict.isAllowed()
        && (action == ProtectedAction.OPEN_CONTAINER || action == ProtectedAction.BREAK)) {
      var block = Guard.world(location).getBlockAt(location);
      if (!(action == ProtectedAction.OPEN_CONTAINER
          ? locks.mayOpen(player, actor.bypass(), LockGuard.container(block))
          : locks.mayBreak(player, actor.bypass(), LockGuard.container(block)))) {
        verdict = new Verdict.Deny(new Denial.Locked());
      }
    }
    return decision(verdict);
  }

  /**
   * Players: both players' own PvP must be on, and PvP must be on where the attacker stands and
   * where the victim stands. The port is not told who the victim is, so every player standing at
   * {@code victimAt} counts as one: if any of them has PvP off, the harm is refused. Everything
   * else passive: the victim's land must let the attacker hurt animals; a pet's owner is the
   * calling module's concern, since the port is not told who owns the creature.
   */
  @Override
  public Decision checkHarm(
      UUID attacker, Location attackerAt, HarmTarget target, Location victimAt) {
    requireMainThread();
    var actor = actor(attacker);
    return decision(
        switch (target) {
          case PLAYER -> harmPlayer(actor, attackerAt, victimAt);
          case PASSIVE ->
              engine()
                  .decide(
                      actor, new Act(Action.DAMAGE_ENTITY, Subject.ANIMAL), guard.land(victimAt));
        });
  }

  private Verdict harmPlayer(Actor actor, Location attackerAt, Location victimAt) {
    var attackerLand = guard.land(attackerAt);
    var victimLand = guard.land(victimAt);
    var verdict = engine().decideAttack(actor, attackerLand, victimLand);
    var point = victimAt.toVector();
    for (var player : Guard.world(victimAt).getPlayers()) {
      if (!player.getUniqueId().equals(actor.player()) && standsAt(player, point)) {
        verdict =
            verdict.and(engine().decidePvp(actor, player.getUniqueId(), attackerLand, victimLand));
      }
    }
    return verdict;
  }

  private static boolean standsAt(Player player, Vector point) {
    return player.getBoundingBox().expand(VICTIM_SLACK).contains(point);
  }

  @Override
  public boolean sameLand(Location a, Location b) {
    requireMainThread();
    return guard.land(a).sameOwnerAs(guard.land(b));
  }

  private ProtectionEngine engine() {
    return guard.engine();
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
