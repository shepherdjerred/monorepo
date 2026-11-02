package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.players.Nicknames;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Denial;
import com.shepherdjerred.thestorm.towns.domain.protection.DenialThrottle;
import com.shepherdjerred.thestorm.towns.domain.protection.FriendNotice;
import com.shepherdjerred.thestorm.towns.domain.protection.OwnerAlerts;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.time.InstantSource;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/** Towns messages in the house style, and denial notices rate-limited per player. */
final class Notices {

  static final String LABEL = "Towns";

  /** How often the same denial is repeated to a visitor and to an owner. */
  record Rates(DenialThrottle visitors, OwnerAlerts owners) {}

  /** The clock denials are stamped with, and the thread their messages return on. */
  record Clock(InstantSource time, Scheduler scheduler) {}

  /** Who can be told, and where a denial is written. */
  record Delivery(
      Server server, PlayerDirectory directory, Services services, ComponentLogger logger) {}

  private final TownsState state;
  private final DenialThrottle throttle;
  private final OwnerAlerts owners;
  private final InstantSource time;
  private final Scheduler scheduler;
  private final Server server;
  private final PlayerDirectory directory;
  private final Services services;
  private final ComponentLogger logger;

  Notices(TownsState state, Rates rates, Clock clock, Delivery delivery) {
    this.state = state;
    this.throttle = rates.visitors();
    this.owners = rates.owners();
    this.time = clock.time();
    this.scheduler = clock.scheduler();
    this.server = delivery.server();
    this.directory = delivery.directory();
    this.services = delivery.services();
    this.logger = delivery.logger();
  }

  static Component info(String message) {
    return HouseStyle.info(LABEL, Component.text(message));
  }

  static Component success(String message) {
    return HouseStyle.success(LABEL, Component.text(message));
  }

  static Component error(String message) {
    return HouseStyle.error(LABEL, Component.text(message));
  }

  /**
   * Tells {@code player} why they were stopped, unless they were just told the same thing. The
   * message is rendered now, while the town it names certainly exists, and sent on the next tick,
   * after the listener has cancelled the event.
   */
  void denied(Player player, Denial denial) {
    if (!throttle.shouldTell(player.getUniqueId(), denial, time.millis())) {
      return;
    }
    if (denial instanceof Denial.ByTown(var townId, var action)) {
      var town = state.town(townId);
      if (town.isPresent() && FriendNotice.shouldAlert(town.get(), player.getUniqueId(), action)) {
        tellFriend(player, town.get(), action);
        return;
      }
    }
    var message = render(denial);
    scheduler.runOnMainThread(() -> player.sendMessage(message));
  }

  void forget(Player player) {
    throttle.forget(player.getUniqueId());
    owners.forget(player.getUniqueId());
  }

  private void tellFriend(Player visitor, Town town, Action action) {
    logDenial(visitor, town, action);
    var lookup = directory.byId(town.owner());
    var _ =
        lookup.whenCompleteAsync(
            (found, failure) -> {
              if (!visitor.isOnline()) {
                return;
              }
              if (failure != null || found == null || found.isEmpty()) {
                logger.error(
                    "Camp owner {} is missing from the player directory", town.owner(), failure);
                visitor.sendMessage(render(new Denial.ByTown(town.id(), action)));
                return;
              }
              var ownerAccount = found.orElseThrow().lastName();
              visitor.sendMessage(error(FriendNotice.visitor(town, action, ownerAccount)));
              var owner = server.getPlayer(town.owner());
              if (owner == null || !owner.isOnline()) {
                return;
              }
              if (!owners.shouldTell(owner.getUniqueId(), visitor.getUniqueId(), time.millis())) {
                return;
              }
              var visitorName =
                  services
                      .find(Nicknames.class)
                      .map(nicknames -> nicknames.display(visitor.getUniqueId(), visitor.getName()))
                      .orElseGet(visitor::getName);
              owner.sendMessage(info(FriendNotice.owner(town, action, visitorName)));
            },
            scheduler.mainThread());
  }

  private void logDenial(Player visitor, Town town, Action action) {
    var at = visitor.getLocation();
    var world = at == null ? null : at.getWorld();
    if (at == null || world == null) {
      logger.info("player-denied {} {} {} unknown", visitor.getName(), action, town.name());
      return;
    }
    logger.info(
        "player-denied {} {} {} {} {} {} {}",
        visitor.getName(),
        action,
        town.name(),
        world.getName(),
        at.getBlockX(),
        at.getBlockY(),
        at.getBlockZ());
  }

  Component render(Denial denial) {
    return error(
        switch (denial) {
          case Denial.ByTown(var townId, var action) ->
              townName(townId) + " owns this land; you can't " + verb(action) + " here.";
          case Denial.ByRegion(var region, var action) ->
              region + " is protected; you can't " + verb(action) + " here.";
          case Denial.NoPvp() -> "PvP is off here.";
          case Denial.YourPvpIsOff() -> "Your PvP is off. Turn it on with /pvp on.";
          case Denial.TheirPvpIsOff() -> "They have turned their PvP off.";
          case Denial.NotYourPet() -> "That pet belongs to someone else.";
          case Denial.Locked() -> "That is locked.";
        });
  }

  private String townName(UUID townId) {
    return state
        .town(townId)
        .orElseThrow(() -> new IllegalStateException("claim held by unknown town " + townId))
        .name();
  }

  static String verb(Action action) {
    return switch (action) {
      case BUILD -> "build";
      case BREAK -> "break things";
      case INTERACT, INTERACT_ENTITY -> "use that";
      case OPEN_CONTAINER -> "open that";
      case USE_REDSTONE -> "change redstone";
      case DAMAGE_ENTITY -> "hurt that";
      case PLACE_ENTITY -> "place that";
      case ATTACK_PLAYER -> "fight";
      case TELEPORT_INTO -> "teleport in";
      case SET_HOME -> "set a home";
    };
  }
}
