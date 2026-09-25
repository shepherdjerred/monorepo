package com.shepherdjerred.thestorm.essentials.domain.tpa;

import java.util.UUID;

/** Which request a target answers. */
public sealed interface TpaSelector {

  /** The most recent live request ({@code /tpaccept} with no arguments). */
  record Newest() implements TpaSelector {}

  /** The live request from one player ({@code /tpaccept <player>}). */
  record From(UUID requester) implements TpaSelector {}

  /** Exactly one request, as shown in the clickable buttons ({@code /tpaccept <player> <id>}). */
  record Exact(UUID requester, long id) implements TpaSelector {}
}
