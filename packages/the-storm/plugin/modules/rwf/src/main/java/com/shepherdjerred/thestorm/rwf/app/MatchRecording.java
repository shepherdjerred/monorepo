package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.domain.record.Frame;
import com.shepherdjerred.thestorm.rwf.domain.record.InputFrame;
import com.shepherdjerred.thestorm.rwf.domain.record.Intent;
import com.shepherdjerred.thestorm.rwf.domain.record.ObservationFrame;
import com.shepherdjerred.thestorm.rwf.domain.record.Occurrence;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEnd;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEvent;
import java.util.concurrent.CompletableFuture;

/**
 * One match being recorded. Every row is kept: the writer buffers whatever it has not yet written,
 * however far behind it falls. Only past a memory-safety cap far beyond any match are per-tick
 * samples (frames, inputs and observations) dropped, each drop logged as an error and the count
 * reported at the end.
 */
public interface MatchRecording {

  void event(RecordEvent event);

  void frame(Frame frame);

  void input(InputFrame input);

  void observation(ObservationFrame observation);

  void intent(Intent intent);

  /** A schema 4 occurrence: a kill, the ballot, chat, a world change, a pulse and the like. */
  void occurrence(Occurrence occurrence);

  /** Writes the end row and closes the file; the future completes with what was written. */
  CompletableFuture<RecordingSummary> end(RecordEnd end);
}
