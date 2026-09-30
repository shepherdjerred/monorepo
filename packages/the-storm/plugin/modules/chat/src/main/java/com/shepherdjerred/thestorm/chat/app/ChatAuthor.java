package com.shepherdjerred.thestorm.chat.app;

import java.util.UUID;

/** Who wrote a Global chat line. */
public sealed interface ChatAuthor {

  /** The author's display name, unescaped. */
  String name();

  /** A player on the server. */
  record InGame(UUID id, String name) implements ChatAuthor {}

  /** Someone outside the game, such as a Discord user; {@code source} names the bridge. */
  record External(String source, String name) implements ChatAuthor {}
}
