package com.shepherdjerred.thestorm.skylands.domain;

import java.util.List;

/** A walk, a supported gap crossing, or a ladder up a real cliff face. */
public record SkyRoute(List<Segment> segments) {
  public enum Kind {
    WALK,
    BRIDGE,
    CLIFF
  }

  public record Segment(SkyPosition from, SkyPosition to, Kind kind) {}

  public SkyRoute {
    segments = List.copyOf(segments);
  }

  public List<SkyPosition> destinations() {
    return segments.stream().map(Segment::to).toList();
  }
}
