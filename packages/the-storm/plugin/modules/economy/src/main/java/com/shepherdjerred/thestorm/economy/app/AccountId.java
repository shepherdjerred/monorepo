package com.shepherdjerred.thestorm.economy.app;

import java.util.UUID;

/** Who holds crystals: a player, a town treasury, or the server (the source and sink of money). */
public sealed interface AccountId {

  /** A player's wallet. */
  record Player(UUID uuid) implements AccountId {}

  /** A town's treasury, keyed by the town's id. */
  record Town(UUID townId) implements AccountId {}

  /** The server: NPC shops, quest rewards and fees pay out of and into it. Unlimited. */
  record Server() implements AccountId {}
}
