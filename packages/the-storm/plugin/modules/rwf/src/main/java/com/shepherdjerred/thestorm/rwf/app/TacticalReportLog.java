package com.shepherdjerred.thestorm.rwf.app;

import java.time.Duration;
import java.time.InstantSource;
import java.util.ArrayDeque;
import java.util.List;

/** Bounded, sequenced sensor history; each consumer retains its own cursor. */
public final class TacticalReportLog implements TacticalReports {
  public static final Duration RETENTION = Duration.ofSeconds(8);
  public static final int CAPACITY = 1024;
  private final InstantSource time;
  private final ArrayDeque<Cue> history = new ArrayDeque<>();
  private long sequence;

  public TacticalReportLog(InstantSource time) {
    this.time = time;
  }

  @Override
  public synchronized Cue emit(Report report) {
    prune();
    var cue = new Cue(++sequence, report, time.instant());
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
    while (!history.isEmpty() && !history.getFirst().at().isAfter(oldest)) history.removeFirst();
  }
}
