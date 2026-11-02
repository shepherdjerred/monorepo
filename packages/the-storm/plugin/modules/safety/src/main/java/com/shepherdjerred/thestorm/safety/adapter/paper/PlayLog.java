package com.shepherdjerred.thestorm.safety.adapter.paper;

import org.bukkit.Location;

/** One console line for a player action Loki can answer without the evidence archive. */
final class PlayLog {

  private PlayLog() {}

  static String command(String account, Location at, String text, String outcome) {
    return command(account, where(at), text, outcome);
  }

  static String command(String account, String where, String text, String outcome) {
    return "player-command " + account + " " + where + " " + text + " " + outcome;
  }

  static String position(String account, Location at, String nick) {
    return position(account, where(at), nick);
  }

  static String position(String account, String where, String nick) {
    var line = "player-where " + account + " " + where;
    if (!nick.equals(account)) {
      line = line + " nick=" + nick;
    }
    return line;
  }

  /** The two ends of a teleport, already rendered as world and block coordinates. */
  record Move(String from, String to, String cause, boolean cancelled) {}

  static Move move(Location from, Location to, String cause, boolean cancelled) {
    return new Move(where(from), where(to), cause, cancelled);
  }

  static String teleport(String account, Move move) {
    return "player-teleport "
        + account
        + " "
        + move.from()
        + " -> "
        + move.to()
        + " cause="
        + move.cause()
        + " cancelled="
        + move.cancelled();
  }

  static String where(Location at) {
    var world = at.getWorld();
    var name = world == null ? "unknown" : world.getName();
    return name + " " + at.getBlockX() + " " + at.getBlockY() + " " + at.getBlockZ();
  }
}
