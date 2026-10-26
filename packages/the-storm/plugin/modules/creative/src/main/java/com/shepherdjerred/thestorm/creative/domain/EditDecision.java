package com.shepherdjerred.thestorm.creative.domain;

import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.Set;
import java.util.UUID;

/**
 * Whether a WorldEdit may change a creative plot. The mask is the plot the actor is standing in,
 * and only when they own it, are a member, or are trusted. A selection that leaves that column, or
 * that is larger than one column of the world, is refused whole. Command names here are ours: the
 * reference plugin does not ship this denylist.
 */
public final class EditDecision {

  private static final Set<String> BLOCKED =
      Set.of(
          "regen",
          "delchunks",
          "chunk",
          "world",
          "snapshot",
          "restore",
          "generate",
          "calc",
          "deform",
          "forest",
          "flora");

  /**
   * WorldEdit commands that do not change the world. They stay available when a selection is too
   * big, so the player can shrink it. {@code //limit} is one of them.
   */
  private static final Set<String> INSPECTION =
      Set.of(
          "pos1",
          "pos2",
          "hpos1",
          "hpos2",
          "sel",
          "desel",
          "deselect",
          "expand",
          "contract",
          "outset",
          "inset",
          "shift",
          "size",
          "count",
          "distr",
          "distribute",
          "undo",
          "redo",
          "clearhistory",
          "help",
          "limit",
          "wand",
          "toggleeditwand",
          "mask",
          "gmask",
          "fast",
          "reorder",
          "drawsel",
          "searchitem",
          "search",
          "schem",
          "schematic",
          "copy",
          "clearclipboard");

  private EditDecision() {}

  /**
   * Whether {@code actor} may edit a plot owned by {@code owner}. Members and trusted players may.
   * Denied players and strangers may not. An unclaimed plot has no editor until someone owns it.
   */
  public static boolean mayEdit(UUID actor, Optional<UUID> owner, Map<UUID, PlotRole> access) {
    if (owner.isEmpty()) {
      return false;
    }
    return owner.orElseThrow().equals(actor) || PlotRole.builds(access, actor);
  }

  /**
   * Whether every block of {@code selection} sits inside {@code plot} and the selection is no
   * larger than that plot's full-height column in a world whose blocks run {@code worldMinY}
   * through {@code worldMaxY}.
   */
  public static boolean selectionFits(
      PlotBounds plot, BlockBox selection, int worldMinY, int worldMaxY) {
    if (selection.volume() > plot.columnVolume(worldMinY, worldMaxY)) {
      return false;
    }
    return plot.contains(selection.minX(), selection.minZ())
        && plot.contains(selection.maxX(), selection.maxZ());
  }

  /** Whether a brush of {@code radius} stays inside {@code cap}. */
  public static boolean brushFits(int radius, int cap) {
    return radius >= 0 && radius <= cap;
  }

  /** A road has no plot, so the mask is empty and the edit is refused. */
  public static boolean onRoad(Optional<PlotId> standing) {
    return standing.isEmpty();
  }

  /**
   * The standing plot when {@code allowed} is true. Empty refuses the whole edit: a road, or a plot
   * the actor does not own and is not trusted on. Staff bypass is decided by the caller.
   */
  public static Optional<PlotBounds> mask(
      PlotGrid grid, Optional<PlotId> standing, boolean allowed) {
    if (standing.isEmpty() || !allowed) {
      return Optional.empty();
    }
    return Optional.of(grid.bounds(standing.orElseThrow()));
  }

  /**
   * The radius argument of a {@code brush} or {@code br} command, when it has one. Other commands
   * return empty.
   */
  public static OptionalInt commandedBrushRadius(String commandLine) {
    var name = head(commandLine);
    if (!name.equals("brush") && !name.equals("br") && !name.equals("size")) {
      return OptionalInt.empty();
    }
    return firstInteger(remainder(commandLine));
  }

  private static OptionalInt firstInteger(String rest) {
    var start = 0;
    while (start <= rest.length()) {
      var end = rest.indexOf(' ', start);
      if (end < 0) {
        end = rest.length();
      }
      var parsed = integerToken(rest.substring(start, end));
      if (parsed.isPresent()) {
        return parsed;
      }
      if (end == rest.length()) {
        return OptionalInt.empty();
      }
      start = end + 1;
    }
    return OptionalInt.empty();
  }

  /** Empty when {@code part} is not an integer token. */
  private static OptionalInt integerToken(String part) {
    if (part.isEmpty()) {
      return OptionalInt.empty();
    }
    var digits = part.charAt(0) == '-' ? part.substring(1) : part;
    if (digits.isEmpty() || !digits.chars().allMatch(Character::isDigit)) {
      return OptionalInt.empty();
    }
    try {
      return OptionalInt.of(Integer.parseInt(part));
    } catch (NumberFormatException failure) {
      return OptionalInt.empty();
    }
  }

  /**
   * Whether {@code commandLine} is one of the denied WorldEdit commands. A leading slash, a second
   * slash, and a {@code plugin:} prefix are ignored.
   */
  public static boolean blockedCommand(String commandLine) {
    return BLOCKED.contains(head(commandLine));
  }

  /**
   * Whether {@code message} is a WorldEdit command. A double slash and a {@code worldedit:} or
   * {@code we:} label count. Other plugins, including {@code /creative}, do not.
   */
  public static boolean worldEditCommand(String message) {
    var body = message.strip();
    if (body.startsWith("/")) {
      body = body.substring(1);
    }
    if (body.startsWith("/")) {
      return true;
    }
    int space = body.indexOf(' ');
    var first = space < 0 ? body : body.substring(0, space);
    var lower = first.toLowerCase(Locale.ROOT);
    return lower.equals("worldedit")
        || lower.equals("we")
        || lower.startsWith("worldedit:")
        || lower.startsWith("we:");
  }

  /**
   * Whether {@code commandLine} changes blocks. Selection and inspection commands do not, so a
   * player can correct a selection that leaves the plot.
   */
  public static boolean editsWorld(String commandLine) {
    return !INSPECTION.contains(head(commandLine));
  }

  /** The command name with slashes and a plugin prefix removed. */
  private static String head(String commandLine) {
    var token = commandLine.strip();
    int space = token.indexOf(' ');
    if (space >= 0) {
      token = token.substring(0, space);
    }
    while (token.startsWith("/")) {
      token = token.substring(1);
    }
    int colon = token.lastIndexOf(':');
    if (colon >= 0) {
      token = token.substring(colon + 1);
    }
    while (token.startsWith("/")) {
      token = token.substring(1);
    }
    return token.toLowerCase(Locale.ROOT);
  }

  private static String remainder(String commandLine) {
    var token = commandLine.strip();
    int space = token.indexOf(' ');
    if (space < 0) {
      return "";
    }
    return token.substring(space + 1);
  }
}
