package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.app.store.MatchStats;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/**
 * A match whose statistics have been stored. Delivered on the main thread after that write, so a
 * lifetime read sees it. This is not the match-end notification, which can run before the write.
 */
public final class RwfCareers {

  private final List<Consumer<Settled>> listeners = new ArrayList<>();

  public void subscribe(Consumer<Settled> listener) {
    listeners.add(listener);
  }

  public void settled(MatchStats stats) {
    var event = new Settled(stats.players());
    List.copyOf(listeners).forEach(listener -> listener.accept(event));
  }

  /**
   * The humans in a match whose statistics were just stored.
   *
   * @param players one line per human who played
   */
  public record Settled(List<MatchStats.PlayerLine> players) {

    public Settled {
      players = List.copyOf(players);
    }
  }
}
