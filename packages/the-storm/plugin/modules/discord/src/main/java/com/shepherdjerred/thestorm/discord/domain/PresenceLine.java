package com.shepherdjerred.thestorm.discord.domain;

import java.util.ArrayList;
import java.util.List;

/** The bot's custom status: who is online and which games are running. */
public final class PresenceLine {

  /** Discord's limit on a custom status. */
  public static final int LIMIT = 128;

  private PresenceLine() {}

  /**
   * {@code 12 online · S&D: 6 playing · Rustworks: wave 41}, or {@code idle} when nobody is on and
   * nothing runs.
   */
  public static String format(int online, List<String> activities, String idle) {
    if (online == 0 && activities.isEmpty()) {
      return idle;
    }
    var parts = new ArrayList<String>();
    parts.add(online + " online");
    parts.addAll(activities);
    var line = String.join(" · ", parts);
    return line.length() <= LIMIT ? line : line.substring(0, LIMIT - 1) + "…";
  }
}
