package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.app.view.Point;
import java.time.Duration;
import java.time.Instant;

/** A device hears only sounds emitted during its lifetime and inside both hearing radii. */
public record ListeningPost(
    Point at, Instant placed, Instant until, Instant nextReport, long afterSequence) {
  public ListeningPost(Point at, Instant placed, Instant until, Instant nextReport) {
    this(at, placed, until, nextReport, 0);
  }

  public boolean hears(BattleSounds.Cue cue, Instant now) {
    var sound = cue.sound();
    var reach = Math.min(12, sound.radius());
    var point = sound.position();
    var dx = at.x() - point.x();
    var dy = at.y() - point.y();
    var dz = at.z() - point.z();
    return cue.sequence() > afterSequence
        && now.isBefore(until)
        && !now.isBefore(nextReport)
        && !cue.at().isBefore(placed)
        && dx * dx + dy * dy + dz * dz <= reach * reach;
  }

  public ListeningPost reported(Instant now) {
    return new ListeningPost(at, placed, until, now.plus(Duration.ofSeconds(3)), afterSequence);
  }

  /** A four-block cell, deliberately less precise than the original source location. */
  public static Point approximate(Point sound) {
    return new Point(cell(sound.x()), cell(sound.y()), cell(sound.z()));
  }

  private static double cell(double coordinate) {
    return Math.floor(coordinate / 4) * 4 + 2;
  }
}
