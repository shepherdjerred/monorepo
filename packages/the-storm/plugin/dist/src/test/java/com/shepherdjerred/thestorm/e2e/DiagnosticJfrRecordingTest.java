package com.shepherdjerred.thestorm.e2e;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import jdk.jfr.Event;
import jdk.jfr.Name;
import jdk.jfr.Recording;
import jdk.jfr.RecordingState;
import jdk.jfr.StackTrace;
import jdk.jfr.consumer.RecordingFile;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Real public-JFR lifecycle contract, without a Paper runtime or profiling another process. */
final class DiagnosticJfrRecordingTest {
  @TempDir Path directory;

  @Name("storm.FixtureJfrLifecycleTest")
  @StackTrace(false)
  static final class Marker extends Event {
    int value;
  }

  @Test
  void destinationStopClosesAndExportsReadableEventsWithoutDump() throws Exception {
    var destination = directory.resolve("capture.jfr");
    var recording = new Recording(Map.of("storm.FixtureJfrLifecycleTest#enabled", "true"));
    try (recording) {
      recording.setToDisk(true);
      recording.setMaxSize(8 * 1024 * 1024);
      recording.setDuration(Duration.ofSeconds(10));
      recording.setDestination(destination);
      recording.start();
      var marker = new Marker();
      marker.value = 42;
      marker.commit();

      assertTrue(recording.stop());
      assertEquals(RecordingState.CLOSED, recording.getState());
      assertTrue(Files.size(destination) > 0);
      var events = RecordingFile.readAllEvents(destination);
      assertTrue(
          events.stream()
              .anyMatch(
                  event ->
                      event.getEventType().getName().equals("storm.FixtureJfrLifecycleTest")
                          && event.getInt("value") == 42));
      assertThrows(IOException.class, () -> recording.dump(directory.resolve("invalid.jfr")));
    }
    assertEquals(RecordingState.CLOSED, recording.getState());
  }
}
