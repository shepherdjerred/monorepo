package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.domain.record.Frame;
import com.shepherdjerred.thestorm.rwf.domain.record.Intent;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEnd;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEvent;
import java.util.concurrent.CompletableFuture;

/**
 * One match being recorded. Events and intents are never dropped; frames may be when the writer
 * falls behind, and the count of dropped frames is reported at the end.
 */
public interface MatchRecording {

  void event(RecordEvent event);

  void frame(Frame frame);

  void intent(Intent intent);

  /** Writes the end row and closes the file; the future completes with what was written. */
  CompletableFuture<RecordingSummary> end(RecordEnd end);
}
