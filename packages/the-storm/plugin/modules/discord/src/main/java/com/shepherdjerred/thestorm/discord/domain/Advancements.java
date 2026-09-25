package com.shepherdjerred.thestorm.discord.domain;

/** Which advancements are worth posting. */
public final class Advancements {

  private Advancements() {}

  /**
   * Whether an advancement is a real one the game announces: it has a display, the game announces
   * it in chat, and it is not a recipe unlock (recipes have no display, but the key check keeps
   * data-pack recipes out too).
   *
   * @param key the advancement key's path, such as {@code story/mine_stone}
   */
  public static boolean shouldPost(String key, boolean hasDisplay, boolean announcedInChat) {
    return hasDisplay && announcedInChat && !key.startsWith("recipes/");
  }
}
