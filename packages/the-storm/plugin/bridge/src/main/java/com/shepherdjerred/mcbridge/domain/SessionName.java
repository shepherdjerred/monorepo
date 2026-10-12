package com.shepherdjerred.mcbridge.domain;

import java.util.regex.Pattern;

/** A WorldEdit agent session name ({@code [a-z0-9-]{1,32}}); the actor is {@code agent:<name>}. */
public record SessionName(String value) {
  private static final Pattern VALID = Pattern.compile("[a-z0-9-]{1,32}");

  public SessionName {
    if (!VALID.matcher(value).matches()) {
      throw BridgeException.badRequest("session must match [a-z0-9-]{1,32}: " + value);
    }
  }

  /** The WorldEdit actor name, which CoreProtect and logs show. */
  public String actorName() {
    return "agent:" + value;
  }
}
