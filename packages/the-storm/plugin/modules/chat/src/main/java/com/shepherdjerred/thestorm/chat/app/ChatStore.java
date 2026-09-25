package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatProfile;
import com.shepherdjerred.thestorm.chat.domain.Mute;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Chat persistence. Every call is asynchronous and writes apply in the order they are made. Writes
 * are fire-and-forget: the in-memory state is authoritative while the server runs, and the
 * implementation reports a failed write itself.
 */
public interface ChatStore {

  /**
   * Loads every stored profile and every mute that is still active at {@code now}, deleting ended
   * mutes. Profiles are completed with {@code defaultFocus} when no focus was stored.
   */
  CompletableFuture<ChatSnapshot> loadAll(Instant now, ChannelKey defaultFocus);

  /** Replaces {@code player}'s stored focus, hidden channels and ignores with {@code profile}. */
  void saveProfile(UUID player, ChatProfile profile);

  /** Stores {@code mute} for {@code player}, replacing any earlier one. */
  void saveMute(UUID player, Mute mute);

  /** Removes {@code player}'s mute. */
  void deleteMute(UUID player);
}
