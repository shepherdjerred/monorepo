package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Denial;
import com.shepherdjerred.thestorm.towns.domain.protection.DenialThrottle;
import java.time.InstantSource;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;

/** Towns messages in the house style, and denial notices rate-limited per player. */
final class Notices {

  static final String LABEL = "Towns";

  private final TownsState state;
  private final DenialThrottle throttle;
  private final InstantSource time;
  private final Scheduler scheduler;

  Notices(TownsState state, DenialThrottle throttle, InstantSource time, Scheduler scheduler) {
    this.state = state;
    this.throttle = throttle;
    this.time = time;
    this.scheduler = scheduler;
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
    if (throttle.shouldTell(player.getUniqueId(), denial, time.millis())) {
      var message = render(denial);
      scheduler.runOnMainThread(() -> player.sendMessage(message));
    }
  }

  void forget(Player player) {
    throttle.forget(player.getUniqueId());
  }

  Component render(Denial denial) {
    return error(
        switch (denial) {
          case Denial.ByTown(var townId, var action) ->
              townName(townId) + " owns this land; you can't " + verb(action) + " here.";
          case Denial.ByRegion(var region, var action) ->
              region + " is protected; you can't " + verb(action) + " here.";
          case Denial.NoPvp() -> "PvP is off here.";
          case Denial.NotYourPet() -> "That pet belongs to someone else.";
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
