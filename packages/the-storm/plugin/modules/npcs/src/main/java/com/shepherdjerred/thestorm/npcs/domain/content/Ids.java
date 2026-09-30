package com.shepherdjerred.thestorm.npcs.domain.content;

import java.util.regex.Pattern;

/** The shape of every content id: NPCs, places, skins, schedules, dialogues and roles. */
public final class Ids {

  /** What a valid id looks like, for error messages. */
  public static final String RULE =
      "ids are 1-32 lowercase letters, digits, - and _, starting with a letter or digit";

  /** The value that means "no reference" wherever a reference is optional. */
  public static final String NONE = "none";

  private static final Pattern ID = Pattern.compile("[a-z0-9][a-z0-9_-]{0,31}");

  private Ids() {}

  public static boolean valid(String id) {
    return ID.matcher(id).matches() && !NONE.equals(id);
  }
}
