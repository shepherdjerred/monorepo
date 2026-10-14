package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.app.view.Point;
import java.util.List;

/** Shared visual obstruction for human visibility and bot perception. Main thread only. */
public interface VisualOcclusion {
  record Field(Point center, double radius) {}

  boolean obscured(Point from, Point to);

  /** Immutable geometry captured on the main thread for off-thread perception. */
  List<Field> snapshot();
}
