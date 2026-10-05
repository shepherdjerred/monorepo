package com.shepherdjerred.thestorm.rwf.app;

import java.util.Optional;

/**
 * What a finished recording came to.
 *
 * @param file the written file, relative to the plugin data folder; empty when recording is off
 * @param bytes the compressed size
 * @param droppedFrames per-tick samples (frames and human inputs) the writer could not keep up with
 */
public record RecordingSummary(Optional<String> file, long bytes, int droppedFrames) {

  public static final RecordingSummary NONE = new RecordingSummary(Optional.empty(), 0, 0);

  public RecordingSummary {
    if (bytes < 0 || droppedFrames < 0) {
      throw new IllegalArgumentException("bytes and droppedFrames must not be negative");
    }
  }
}
