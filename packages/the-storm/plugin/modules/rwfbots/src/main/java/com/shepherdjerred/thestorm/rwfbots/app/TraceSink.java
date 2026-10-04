package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwfbots.domain.record.DecisionTrace;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;

/**
 * Where decision traces go. Called from the think job's worker thread, so implementations must be
 * safe to call off the main thread and must never block for long: they enqueue and return.
 */
public interface TraceSink {

  void record(DecisionTrace trace, Decision decision);

  /** A sink that keeps nothing. */
  static TraceSink none() {
    return (trace, decision) -> {};
  }
}
