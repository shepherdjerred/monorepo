package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.app.view.Point;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Anonymous sensor clues; a reporter identifies the friendly device, never the heard enemy. */
public interface TacticalReports {
  record Report(UUID reporter, Point position, double uncertainty) {
    public Report {
      if (!(uncertainty > 0) || !Double.isFinite(uncertainty))
        throw new IllegalArgumentException("a sensor report needs finite positive uncertainty");
    }
  }

  record Cue(long sequence, Report report, Instant at) {}

  Cue emit(Report report);

  List<Cue> since(long cursor);
}
