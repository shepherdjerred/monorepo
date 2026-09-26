package com.shepherdjerred.thestorm.arena.domain.game;

import java.time.Instant;
import java.util.UUID;

/** Something that happened to a game. */
public sealed interface GameEvent {

  /**
   * A player asks to play.
   *
   * @param player the player
   * @param name their name
   */
  record Join(UUID player, String name) implements GameEvent {}

  /**
   * A player asks to watch.
   *
   * @param player the player
   * @param name their name
   */
  record Spectate(UUID player, String name) implements GameEvent {}

  /**
   * A joining player's snapshot is safely stored.
   *
   * @param player the player
   */
  record SnapshotStored(UUID player) implements GameEvent {}

  /**
   * A joining player's snapshot could not be stored; they are dropped untouched.
   *
   * @param player the player
   */
  record SnapshotFailed(UUID player) implements GameEvent {}

  /**
   * A player picks a class.
   *
   * @param player the player
   * @param kit the class id
   * @param permitted whether the player holds the class's permission (always true for open classes)
   */
  record PickClass(UUID player, String kit, boolean permitted) implements GameEvent {}

  /**
   * A player says they are ready.
   *
   * @param player the player
   */
  record Ready(UUID player) implements GameEvent {}

  /**
   * A player leaves on purpose.
   *
   * @param player the player
   */
  record Leave(UUID player) implements GameEvent {}

  /**
   * A player disconnected.
   *
   * @param player the player
   */
  record Disconnect(UUID player) implements GameEvent {}

  /**
   * A player died.
   *
   * @param player the player
   */
  record Died(UUID player) implements GameEvent {}

  /**
   * A second passed.
   *
   * @param now the time
   * @param alive arena entities alive, riders included
   */
  record Tick(Instant now, int alive) implements GameEvent {}

  /**
   * An admin starts the game now; lobby players without a class are sent out.
   *
   * @param now the time
   */
  record ForceStart(Instant now) implements GameEvent {}

  /** The game is stopped (an admin, or the plugin shutting down): everyone is restored. */
  record Stop() implements GameEvent {}
}
