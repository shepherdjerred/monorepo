package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
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
 * offline player never has bypass.
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
    var online = server.getPlayer(player);
    var bypass = online != null && online.hasPermission(Guard.BYPASS_PERMISSION);
    var act = new Act(actionOf(action), subjectOf(action, location));
    return switch (engine.decide(new Actor(player, bypass), act, guard.land(location))) {
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
