package com.shepherdjerred.thestorm.tracks.app;

import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.bukkit.entity.Player;

/**
 * Online players' track progress, loaded when they join and dropped when they leave, so {@link
 * TrackLevels} answers from memory. Updated on the main thread.
 *
 * <p>Each join opens a session with a fresh token, and a load only fills the session it was started
 * for, so a slow load from an earlier session can never fill a later one. Within a session a load
 * never overwrites a newer change: loads only fill a session still waiting for its progress, while
 * changes, which come from the store's latest write, always replace it.
 */
public final class LevelCache implements TrackLevels {

  private final AtomicLong tokens = new AtomicLong();
  private final Map<UUID, Session> sessions = new ConcurrentHashMap<>();

  /** Where an online player's progress stands. */
  public sealed interface State {

    /** Loading since they joined. */
    record Loading() implements State {}

    /** The last load failed; it is being retried. */
    record Failed() implements State {}

    /** Loaded, or replaced by a later change. */
    record Loaded(TrackProgress progress) implements State {}
  }

  private record Session(long token, State state) {}

  /**
   * {@inheritDoc}
   *
   * <p>0 in every track until the player's progress has loaded, a moment after they join.
   */
  @Override
  public int level(Player player, Track track) {
    return level(player.getUniqueId(), track);
  }

  /** {@code player}'s level in {@code track}; 0 if untrained, offline or not loaded yet. */
  public int level(UUID player, Track track) {
    return progress(player).map(progress -> progress.level(track)).orElse(0);
  }

  /** {@code player}'s progress once it has loaded. */
  public Optional<TrackProgress> progress(UUID player) {
    return state(player)
        .flatMap(
            state ->
                state instanceof State.Loaded(var progress)
                    ? Optional.of(progress)
                    : Optional.empty());
  }

  /** {@code player}'s state, empty when they are offline. */
  public Optional<State> state(UUID player) {
    return Optional.ofNullable(sessions.get(player)).map(Session::state);
  }

  /** {@code player} joined: opens a loading session and returns its token. */
  public long joined(UUID player) {
    var token = tokens.incrementAndGet();
    sessions.put(player, new Session(token, new State.Loading()));
    return token;
  }

  /** Whether {@code token} is {@code player}'s current session. */
  public boolean isCurrent(UUID player, long token) {
    var session = sessions.get(player);
    return session != null && session.token() == token;
  }

  /**
   * The load for session {@code token} finished. Ignored if that session has ended or already holds
   * progress from a change.
   */
  public void loaded(UUID player, long token, TrackProgress loaded) {
    sessions.computeIfPresent(
        player,
        (ignored, session) ->
            session.token() == token && !(session.state() instanceof State.Loaded)
                ? new Session(token, new State.Loaded(loaded))
                : session);
  }

  /** The load for session {@code token} failed. Ignored unless that session is still loading. */
  public void failed(UUID player, long token) {
    sessions.computeIfPresent(
        player,
        (ignored, session) ->
            session.token() == token && !(session.state() instanceof State.Loaded)
                ? new Session(token, new State.Failed())
                : session);
  }

  /** {@code player}'s progress was changed and stored. Ignored if they are offline. */
  public void changed(UUID player, TrackProgress changed) {
    sessions.computeIfPresent(
        player, (ignored, session) -> new Session(session.token(), new State.Loaded(changed)));
  }

  /** {@code player} left. */
  public void quit(UUID player) {
    sessions.remove(player);
  }
}
