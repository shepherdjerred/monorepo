package com.shepherdjerred.thestorm.creative.domain;

import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/** A personal schematic file under the creative schematic directory, one player and one name. */
public final class SchematicNames {

  private static final Pattern NAME = Pattern.compile("[A-Za-z0-9_-]{1,32}");

  private SchematicNames() {}

  /** Relative path {@code uuid/name.schem}, or empty when {@code name} is not a single token. */
  public static Optional<String> relative(UUID player, String name) {
    if (!NAME.matcher(name).matches()) {
      return Optional.empty();
    }
    return Optional.of(player + "/" + name + ".schem");
  }
}
