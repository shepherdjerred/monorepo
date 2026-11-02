package com.shepherdjerred.thestorm.core.players;

import java.util.Optional;
import java.util.UUID;

/**
 * Nicknames players have chosen. An account name always wins over a nickname, and a nickname cannot
 * be another account's name. Chat publishes this; commands read it.
 */
public interface Nicknames {

  /** The player who stored {@code nickname}, whether or not they are online. */
  Optional<UUID> named(String nickname);

  /** The name shown in chat, or {@code accountName} when they are not displaying a nickname. */
  String display(UUID player, String accountName);
}
