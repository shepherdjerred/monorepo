package com.shepherdjerred.thestorm.arena.domain.game;

import java.util.Optional;
import java.util.UUID;

/** Someone in an arena, by where they are in the flow. */
public sealed interface Member {

  UUID id();

  /** The player's name, for announcements and the leaderboard. */
  String name();

  /** Whether the member plays (as opposed to watching). */
  enum Role {
    PLAYER,
    SPECTATOR,
  }

  /**
   * Joined, but their snapshot is still being stored; nothing of theirs has been touched yet.
   *
   * @param id the player
   * @param name their name
   * @param role whether they will play or watch
   */
  record Pending(UUID id, String name, Role role) implements Member {}

  /**
   * In the lobby, picking a class.
   *
   * @param id the player
   * @param name their name
   * @param kit the class they picked, if any
   * @param ready whether they said they are ready
   */
  record InLobby(UUID id, String name, Optional<String> kit, boolean ready) implements Member {

    InLobby withKit(String picked) {
      return new InLobby(id, name, Optional.of(picked), ready);
    }

    InLobby asReady() {
      return new InLobby(id, name, kit, true);
    }
  }

  /**
   * Fighting.
   *
   * @param id the player
   * @param name their name
   * @param kit their class
   * @param reached the highest wave they have been alive at the start of; 0 before wave 1
   */
  record Fighter(UUID id, String name, String kit, int reached) implements Member {

    Fighter reaching(int wave) {
      return new Fighter(id, name, kit, wave);
    }
  }

  /**
   * Watching.
   *
   * @param id the player
   * @param name their name
   */
  record Watcher(UUID id, String name) implements Member {}
}
