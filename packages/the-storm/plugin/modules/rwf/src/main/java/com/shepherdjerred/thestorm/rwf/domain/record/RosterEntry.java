package com.shepherdjerred.thestorm.rwf.domain.record;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.util.regex.Pattern;

/**
 * One combatant in a recording.
 *
 * @param pseudonym a short stable alias such as {@code p3}; never a name or UUID
 * @param team their team
 * @param kit the kit id they played
 * @param bot whether a bot played them
 */
public record RosterEntry(String pseudonym, TeamColor team, String kit, boolean bot) {

  static final Pattern PSEUDONYM = Pattern.compile("[a-z][a-z0-9]*");

  public RosterEntry {
    if (!PSEUDONYM.matcher(pseudonym).matches()) {
      throw new IllegalArgumentException("pseudonym must be short lower-case alphanumeric");
    }
    if (kit.isBlank()) {
      throw new IllegalArgumentException("kit must not be blank");
    }
  }
}
