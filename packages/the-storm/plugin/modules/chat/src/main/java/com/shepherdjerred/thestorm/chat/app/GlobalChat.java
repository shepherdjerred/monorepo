package com.shepherdjerred.thestorm.chat.app;

import java.util.function.Consumer;

/** Global chat, for bridges such as Discord. */
public interface GlobalChat {

  /**
   * Delivers every Global line to {@code listener}: player messages and relayed ones (check {@link
   * ChatLine#author()} to skip your own). The listener runs on whichever thread sent the line,
   * often Paper's async chat thread, so it must be thread-safe, must not block and must not touch
   * the Bukkit API.
   */
  Subscription subscribe(Consumer<ChatLine> listener);

  /**
   * Shows a message from outside the game in Global, rendered with the configured external format.
   * Every value is untrusted: it is cleaned and escaped here. Must be called on the main thread.
   *
   * @param source a short label for the bridge, such as {@code D}
   * @param author the outside author's name
   * @param text the message; must not be blank once cleaned
   */
  void broadcastExternal(String source, String author, String text);
}
