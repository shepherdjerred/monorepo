package com.shepherdjerred.thestorm.chat.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * One player's chat preferences. Immutable: every change returns a new profile.
 *
 * @param focus the channel plain chat goes to
 * @param hidden channels the player does not receive
 * @param ignored players whose messages the player does not receive, with their names
 */
public record ChatProfile(ChannelKey focus, Set<ChannelKey> hidden, Map<UUID, String> ignored) {

  public ChatProfile {
    hidden = Set.copyOf(hidden);
    ignored = Map.copyOf(ignored);
    if (hidden.contains(focus)) {
      throw new IllegalArgumentException("the focused channel " + focus + " cannot be hidden");
    }
  }

  /** A new player's profile: focused on {@code focus}, nothing hidden or ignored. */
  public static ChatProfile fresh(ChannelKey focus) {
    return new ChatProfile(focus, Set.of(), Map.of());
  }

  /** Talks in {@code channel} from now on. Focusing a hidden channel shows it again. */
  public ChatProfile focusOn(ChannelKey channel) {
    var shown = EnumSet.noneOf(ChannelKey.class);
    shown.addAll(hidden);
    shown.remove(channel);
    return new ChatProfile(channel, shown, ignored);
  }

  /** Stops receiving {@code channel}. */
  public Result<ChatProfile, ProfileError> hide(ChannelKey channel) {
    if (channel == focus) {
      return Result.err(ProfileError.CANNOT_HIDE_FOCUSED);
    }
    if (hidden.contains(channel)) {
      return Result.err(ProfileError.ALREADY_HIDDEN);
    }
    var next = EnumSet.of(channel);
    next.addAll(hidden);
    return Result.ok(new ChatProfile(focus, next, ignored));
  }

  /** Receives {@code channel} again. */
  public Result<ChatProfile, ProfileError> show(ChannelKey channel) {
    if (!hidden.contains(channel)) {
      return Result.err(ProfileError.NOT_HIDDEN);
    }
    var next = EnumSet.noneOf(ChannelKey.class);
    next.addAll(hidden);
    next.remove(channel);
    return Result.ok(new ChatProfile(focus, next, ignored));
  }

  /** Whether the player receives {@code channel}. */
  public boolean receives(ChannelKey channel) {
    return !hidden.contains(channel);
  }

  /** Whether the player ignores {@code player}. */
  public boolean ignores(UUID player) {
    return ignored.containsKey(player);
  }

  /** Ignores {@code target}, owned by {@code self}. Staff cannot be ignored. */
  public Result<ChatProfile, ProfileError> ignore(UUID self, IgnoreTarget target) {
    if (target.id().equals(self)) {
      return Result.err(ProfileError.CANNOT_IGNORE_SELF);
    }
    if (target.staff()) {
      return Result.err(ProfileError.CANNOT_IGNORE_STAFF);
    }
    if (ignores(target.id())) {
      return Result.err(ProfileError.ALREADY_IGNORED);
    }
    var next = new HashMap<>(ignored);
    next.put(target.id(), target.name());
    return Result.ok(new ChatProfile(focus, hidden, next));
  }

  /** Stops ignoring {@code player}. */
  public Result<ChatProfile, ProfileError> unignore(UUID player) {
    if (!ignores(player)) {
      return Result.err(ProfileError.NOT_IGNORED);
    }
    var next = new HashMap<>(ignored);
    next.remove(player);
    return Result.ok(new ChatProfile(focus, hidden, next));
  }

  /** The ignored player called {@code name}, ignoring case. */
  public Optional<UUID> ignoredNamed(String name) {
    return ignored.entrySet().stream()
        .filter(entry -> entry.getValue().equalsIgnoreCase(name))
        .map(Map.Entry::getKey)
        .findFirst();
  }

  /**
   * A player someone wants to ignore.
   *
   * @param id the player
   * @param name their current name
   * @param staff whether they hold the staff permission
   */
  public record IgnoreTarget(UUID id, String name, boolean staff) {}
}
