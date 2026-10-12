package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.domain.record.RecordHeader;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;

/**
 * Writes match recordings. The Paper adapter hands over immutable record rows on the main thread;
 * the implementation serialises and writes them elsewhere. A disabled recorder accepts everything
 * and writes nothing.
 */
public interface Recorder {

  /** Opens the recording of the match {@code header} describes, as it goes live. */
  MatchRecording begin(RecordHeader header);

  /**
   * Flushes every open recording, waiting at most {@code timeout}; the plugin is disabling. The
   * future completes once the writer has stopped, exceptionally if a recording could not be
   * written.
   */
  CompletableFuture<Void> close(Duration timeout);
}
