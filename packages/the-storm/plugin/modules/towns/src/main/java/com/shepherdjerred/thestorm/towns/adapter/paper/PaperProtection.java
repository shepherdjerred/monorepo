package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.lock.LockAccess;
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
import org.bukkit.block.Block;
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
    if (guard.isSealed(Guard.world(location))) {
      return Decision.allowed();
    }
    var land = guard.land(location);
    var automatic =
        action == ProtectedAction.AUTOMATIC_BUILD || action == ProtectedAction.AUTOMATIC_BREAK;
    var actor =
        automatic && land instanceof Land.HeritageLand ? Actor.player(player) : actor(player);
    var act = new Act(actionOf(action), subjectOf(action, location));
    var verdict =
        opensContainer(action)
                && rendering.kinds().isLockable(location.getBlock().getType())
                && land instanceof Land.TownLand
                && LockGuard.container(location.getBlock()).stream()
                    .anyMatch(block -> locks.lockOf(block) != null)
            ? Verdict.allow()
            : engine().decide(actor, act, land);
    if (verdict.isAllowed()
        && (opensContainer(action)
            || action == ProtectedAction.BREAK
            || action == ProtectedAction.AUTOMATIC_BREAK)) {
      var block = Guard.world(location).getBlockAt(location);
      verdict =
          containerVerdict(new ContainerCheck(player, actor.bypass(), action, block), verdict);
    }
    return decision(verdict);
  }

  @Override
  public java.util.Optional<UUID> automationActor(Location location) {
    if (mayBindServerHistoricalLift(location))
      return java.util.Optional.of(Protection.SERVER_AUTOMATION);
    requireMainThread();
    return guard.automationActor(location);
  }

  @Override
  public Decision checkLift(UUID player, UUID owner, Location location) {
    var ordinary = check(player, ProtectedAction.INTERACT, location);
    if (ordinary.isAllowed()) return ordinary;
    var land = guard.land(location);
    if (owner.equals(Protection.SERVER_HISTORICAL_LIFT) && serverHistoricalLiftLand(land)) {
      return Decision.allowed();
    }
    if (publicShopLift(land, owner) && check(owner, ProtectedAction.BUILD, location).isAllowed()) {
      return Decision.allowed();
    }
    return ordinary;
  }

  @Override
  public boolean mayBindServerHistoricalLift(Location location) {
    requireMainThread();
    return serverHistoricalLiftLand(guard.land(location));
  }

  @Override
  public boolean mayOperateServerHistoricalCircuit(Location location) {
    requireMainThread();
    return serverSpawnLift(guard.land(location));
  }

  @Override
  public boolean mayRestoreHistoricalShop(Location location) {
    requireMainThread();
    if (guard.isSealed(Guard.world(location))) return false;
    var land = guard.land(location).underlyingLand();
    return !(land instanceof Land.WorkLand)
        && (!(land instanceof Land.ParcelLand(var parcel))
            || parcel.phase()
                == com.shepherdjerred.thestorm.towns.domain.parcel.ProtectedParcel.Phase.ACTIVE);
  }

  static boolean serverSpawnLift(Land land) {
    return land instanceof Land.HeritageLand(var site, _, var underlying)
        && site.kind() == com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite.Kind.SERVER
        && site.id().equals("spawn")
        && (underlying instanceof Land.Wilderness
            || (underlying instanceof Land.RegionLand(var region) && region.id().equals("spawn"))
            || (underlying instanceof Land.ParcelLand(var parcel)
                && parcel.definition().kind()
                    == com.shepherdjerred.thestorm.towns.domain.parcel.ParcelKind.PERMANENT_SHOP
                && parcel.phase()
                    == com.shepherdjerred.thestorm.towns.domain.parcel.ProtectedParcel.Phase.ACTIVE
                && parcel.owners().isEmpty()));
  }

  /** Catalogued lifts may also be restored on unclaimed or staff-held historical land. */
  static boolean serverHistoricalLiftLand(Land land) {
    if (serverSpawnLift(land) || land instanceof Land.Wilderness) return true;
    return land instanceof Land.HeritageLand(var site, var editors, var underlying)
        && site.editors().isEmpty()
        && editors.isEmpty()
        && underlying instanceof Land.Wilderness;
  }

  static boolean publicShopLift(Land land, UUID owner) {
    return land instanceof Land.HeritageLand(_, _, Land.ParcelLand(var parcel))
        && parcel.definition().kind()
            == com.shepherdjerred.thestorm.towns.domain.parcel.ParcelKind.PERMANENT_SHOP
        && parcel.phase()
            == com.shepherdjerred.thestorm.towns.domain.parcel.ProtectedParcel.Phase.ACTIVE
        && parcel.owners().contains(owner);
  }

  @Override
  public boolean mayOperateServerHistoricalGate(Location location) {
    requireMainThread();
    return !guard.isSealed(Guard.world(location)) && serverHistoricalGateLand(guard.land(location));
  }

  static boolean serverHistoricalGateLand(Land land) {
    if (!(land instanceof Land.HeritageLand(var site, _, var underlying))) return false;
    return underlying instanceof Land.Wilderness
        || (underlying instanceof Land.ParcelLand(var parcel)
            && parcel.definition().kind()
                != com.shepherdjerred.thestorm.towns.domain.parcel.ParcelKind.RENTAL_SHOP
            && parcel.phase()
                == com.shepherdjerred.thestorm.towns.domain.parcel.ProtectedParcel.Phase.ACTIVE)
        || (underlying instanceof Land.RegionLand(var region)
            && site.kind()
                == com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite.Kind.SERVER
            && region.id().equals(site.id()))
        || (underlying instanceof Land.TownLand(var claim)
            && site.activeTownId().filter(claim.townId()::equals).isPresent());
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
    if (guard.isSealed(Guard.world(attackerAt)) || guard.isSealed(Guard.world(victimAt))) {
      return Decision.allowed();
    }
    var actor = actor(attacker);
    return decision(
        switch (target) {
          case NPC -> Verdict.allow();
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

  @Override
  public boolean isPreserved(Location location) {
    requireMainThread();
    var land = guard.land(location);
    return land instanceof Land.HeritageLand || land instanceof Land.WorkLand;
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

  private static boolean opensContainer(ProtectedAction action) {
    return action == ProtectedAction.OPEN_CONTAINER
        || action == ProtectedAction.INSERT_ITEM
        || action == ProtectedAction.REMOVE_ITEM;
  }

  private record ContainerCheck(UUID player, boolean bypass, ProtectedAction action, Block block) {}

  private Verdict containerVerdict(ContainerCheck check, Verdict verdict) {
    var halves = LockGuard.container(check.block());
    var opened =
        opensContainer(check.action())
            ? locks.mayOpen(check.player(), check.bypass(), halves)
            : locks.mayBreak(check.player(), check.bypass(), halves);
    if (!opened
        || (opensContainer(check.action())
            && halves.stream().anyMatch(block -> !itemMoveAllowed(check, block)))) {
      return new Verdict.Deny(new Denial.Locked());
    }
    return verdict;
  }

  /** Opening is already decided. Insert and remove also follow the lock's direction. */
  private boolean itemMoveAllowed(ContainerCheck check, Block block) {
    if (check.action() == ProtectedAction.OPEN_CONTAINER) {
      return true;
    }
    var online = server.getPlayer(check.player());
    var movement =
        online == null
            ? locks.movement(check.player(), check.bypass(), block)
            : locks.movement(online, block);
    return check.action() == ProtectedAction.INSERT_ITEM
        ? movement == LockAccess.Movement.FULL || movement == LockAccess.Movement.PUT
        : movement == LockAccess.Movement.FULL || movement == LockAccess.Movement.TAKE;
  }

  static Action actionOf(ProtectedAction action) {
    return switch (action) {
      case BUILD, AUTOMATIC_BUILD -> Action.BUILD;
      case BREAK, AUTOMATIC_BREAK -> Action.BREAK;
      case INTERACT -> Action.INTERACT;
      case OPEN_CONTAINER, INSERT_ITEM, REMOVE_ITEM -> Action.OPEN_CONTAINER;
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
      case BUILD,
          BREAK,
          AUTOMATIC_BUILD,
          AUTOMATIC_BREAK,
          INTERACT,
          OPEN_CONTAINER,
          INSERT_ITEM,
          REMOVE_ITEM,
          USE_REDSTONE ->
          rendering.kinds().subject(location.getBlock().getType());
      case DAMAGE_ENTITY, INTERACT_ENTITY, PLACE_ENTITY -> Subject.ENTITY;
      case TELEPORT_INTO, SET_HOME -> Subject.LOCATION;
    };
  }
}
