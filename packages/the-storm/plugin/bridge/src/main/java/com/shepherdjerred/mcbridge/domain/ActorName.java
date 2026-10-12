package com.shepherdjerred.mcbridge.domain;

import java.util.regex.Pattern;

/**
 * A harness actor's name and id: a valid Minecraft player name ({@code [A-Za-z0-9_]{1,16}}), so
 * events and commands attribute to it exactly as they would to a player.
 */
public record ActorName(String value) {
  private static final Pattern VALID = Pattern.compile("[A-Za-z0-9_]{1,16}");

  public ActorName {
    if (!VALID.matcher(value).matches()) {
      throw BridgeException.badRequest("actor name must match [A-Za-z0-9_]{1,16}: " + value);
    }
  }
}
