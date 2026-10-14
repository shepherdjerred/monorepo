package com.shepherdjerred.thestorm.rwf.app;

import java.time.Duration;
import java.time.InstantSource;
import java.util.ArrayDeque;
import java.util.List;

/**
 * One bounded sound history shared by hearing kits and bot perception; never a second recording.
 */
public final class BattleSoundLog implements BattleSounds {
  public static final Duration RETENTION = Duration.ofSeconds(3);
  public static final int CAPACITY = 8192;
  private final InstantSource time;
  private final ArrayDeque<Cue> history = new ArrayDeque<>();
  private long sequence;

  public BattleSoundLog(InstantSource time) {
    this.time = time;
  }

  @Override
  public synchronized Cue emit(Sound sound) {
    prune();
    var cue = new Cue(++sequence, sound, time.instant());
    history.addLast(cue);
    while (history.size() > CAPACITY) history.removeFirst();
    return cue;
  }

  @Override
  public synchronized List<Cue> since(long cursor) {
    prune();
    return history.stream().filter(cue -> cue.sequence() > cursor).toList();
  }

  private void prune() {
    var oldest = time.instant().minus(RETENTION);
    while (!history.isEmpty() && history.getFirst().at().isBefore(oldest)) history.removeFirst();
  }
}
