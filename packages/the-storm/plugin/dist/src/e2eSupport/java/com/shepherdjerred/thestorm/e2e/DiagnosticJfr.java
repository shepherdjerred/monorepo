package com.shepherdjerred.thestorm.e2e;

import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import jdk.jfr.FlightRecorder;
import jdk.jfr.FlightRecorderListener;
import jdk.jfr.Recording;
import jdk.jfr.RecordingState;

/** One disposable diagnostic attempt. No Bukkit, product classes or caller callbacks run here. */
final class DiagnosticJfr implements AutoCloseable {
  enum State {
    UNUSED,
    PREPARING,
    PREPARED,
    ACTIVATING,
    VALIDATING,
    RECORDING,
    STOPPING,
    EXPORTING,
    EXPORTED,
    COMPLETE,
    FAILED
  }

  private enum Request {
    ACTIVATE,
    STOP
  }

  record Binding(UUID match, UUID attempt) {}

  record Limits(Duration duration, long maximumBytes, Duration activationWait) {
    static Limits diagnostic() {
      return new Limits(Duration.ofSeconds(300), 250L * 1024 * 1024, Duration.ofSeconds(30));
    }
  }

  record Detail(
      long recordingId,
      String started,
      String stopped,
      String originalSettingsSha256,
      String appliedSettingsSha256,
      Map<String, String> settings,
      String relativeFile,
      DiagnosticJfrFiles.Export export) {}

  record Status(
      State state,
      Binding binding,
      boolean workerAlive,
      boolean liveValidated,
      boolean foreignRecordingObserved,
      String failure,
      Detail detail) {}

  @FunctionalInterface
  interface SettingsSource {
    DiagnosticJfrSettings.Settings load() throws Exception;
  }

  private final Path root;
  private final SettingsSource settingsSource;
  private final Limits limits;
  private final Object terminalTransition = new Object();
  private final LinkedBlockingQueue<Request> requests = new LinkedBlockingQueue<>(4);
  private final AtomicReference<String> invalid = new AtomicReference<>("");
  private final AtomicBoolean foreign = new AtomicBoolean();
  private final AtomicReference<State> state = new AtomicReference<>(State.UNUSED);
  private volatile boolean validated;
  private volatile boolean explicitStop;
  private volatile boolean closed;
  private volatile Thread worker;
  private volatile Binding binding;
  private volatile Detail detail;

  DiagnosticJfr(Path root, Class<?> serverClass) {
    this(root, () -> DiagnosticJfrSettings.fromServer(serverClass), Limits.diagnostic());
  }

  DiagnosticJfr(Path root, SettingsSource settingsSource, Limits limits) {
    this.root = root;
    this.settingsSource = settingsSource;
    this.limits = limits;
  }

  void start(Binding requested) {
    if (closed || !state.compareAndSet(State.UNUSED, State.PREPARING))
      throw new IllegalStateException("JFR attempt already used");
    binding = requested;
    var thread =
        Thread.ofPlatform()
            .name("storm-fixture-jfr-" + requested.attempt())
            .daemon(true)
            .inheritInheritableThreadLocals(false)
            .unstarted(this::run);
    thread.setContextClassLoader(ClassLoader.getPlatformClassLoader());
    worker = thread;
    thread.start();
  }

  /** Called only on the server thread, including once after the worker actually starts JFR. */
  void observeLive(UUID match, boolean live) {
    if (!observing()) return;
    if (binding == null || !binding.match().equals(match) || !live) {
      invalidateObservation("bound match changed before recording stop");
      return;
    }
    if (state.compareAndSet(State.PREPARED, State.ACTIVATING)) {
      requests.offer(Request.ACTIVATE);
    } else if (state.compareAndSet(State.VALIDATING, State.RECORDING)) {
      validated = true;
    }
  }

  void noLiveMatch() {
    invalidateObservation("bound match is no longer Live");
  }

  boolean observing() {
    return switch (state.get()) {
      case PREPARING, PREPARED, ACTIVATING, VALIDATING, RECORDING, STOPPING -> true;
      default -> false;
    };
  }

  Status status(Binding requested) {
    requireBinding(requested);
    return status();
  }

  Status status() {
    var thread = worker;
    var alive = thread != null && thread.isAlive();
    var visible = state.get();
    if (visible == State.EXPORTED) {
      if (!invalid.get().isEmpty()) visible = State.FAILED;
      else if (!alive) visible = State.COMPLETE;
    }
    return new Status(visible, binding, alive, validated, foreign.get(), invalid.get(), detail);
  }

  void stop(Binding requested) {
    requireBinding(requested);
    if (!invalid.get().isEmpty()) throw new IllegalStateException("JFR attempt is invalidated");
    var observed = state.get();
    if (observed == State.EXPORTED
        || observed == State.FAILED
        || observed == State.STOPPING
        || observed == State.EXPORTING) return;
    if (state.compareAndSet(State.RECORDING, State.STOPPING)) explicitStop = true;
    else invalidate("explicit stop before Live activation validation");
    requests.offer(Request.STOP);
  }

  private void requireBinding(Binding requested) {
    if (!requested.equals(binding)) throw new IllegalArgumentException("foreign JFR attempt");
  }

  private void invalidate(String reason) {
    if (invalid.compareAndSet("", reason)) requests.offer(Request.STOP);
  }

  private void invalidateObservation(String reason) {
    synchronized (terminalTransition) {
      if (observing()) invalidate(reason);
    }
  }

  @Override
  public void close() {
    closed = true;
    var thread = worker;
    if (thread != null && thread.isAlive())
      invalidate("plugin disabled before explicit completed export");
  }

  private void run() {
    try {
      record();
    } catch (Exception | LinkageError failure) {
      invalid.compareAndSet("", failure.getClass().getSimpleName() + ": " + failure.getMessage());
    } finally {
      if (foreign.get()) invalid.compareAndSet("", "foreign JFR recording overlapped capture");
      synchronized (terminalTransition) {
        state.set(
            invalid.get().isEmpty() && detail != null && detail.export() != null
                ? State.EXPORTED
                : State.FAILED);
      }
    }
  }

  private void record() throws Exception {
    var settings = settingsSource.load();
    var destination = DiagnosticJfrFiles.prepare(root, binding.attempt(), settings);
    try (var recording = new Recording(settings.values())) {
      var listener = observer(recording);
      FlightRecorder.addListener(listener);
      try {
        prepareRecording(recording, destination);
        if (!recording.getSettings().equals(settings.values()))
          throw new IllegalStateException("applied JFR settings differ from audited settings");
        rejectForeign(recording);
        state.set(State.PREPARED);
        if (requests.poll(limits.activationWait().toMillis(), TimeUnit.MILLISECONDS)
                != Request.ACTIVATE
            || !invalid.get().isEmpty())
          throw new IllegalStateException("Live activation was not permitted");
        rejectForeign(recording);
        recording.start();
        detail = describe(recording, settings, null);
        state.set(State.VALIDATING);
        awaitStop(recording);
        state.set(State.STOPPING);
        scanForeign(recording);
        if (foreign.get()) invalid.compareAndSet("", "foreign JFR recording overlapped capture");
        if (recording.getState() == RecordingState.RUNNING) recording.stop();
        state.set(State.EXPORTING);
        if (recording.getState() != RecordingState.CLOSED)
          throw new IllegalStateException("destination recording did not close on stop");
        detail = describe(recording, settings, DiagnosticJfrFiles.inspect(destination));
        scanForeign(recording);
        if (!validated || !explicitStop)
          invalid.compareAndSet("", "recording ended without validated explicit stop");
      } finally {
        FlightRecorder.removeListener(listener);
      }
    }
  }

  private void prepareRecording(Recording recording, Path destination) throws Exception {
    recording.setName("storm-fixture-" + binding.attempt());
    recording.setToDisk(true);
    recording.setMaxSize(limits.maximumBytes());
    recording.setDuration(limits.duration());
    recording.setDumpOnExit(false);
    recording.setDestination(destination);
  }

  private FlightRecorderListener observer(Recording owned) {
    return new FlightRecorderListener() {
      @Override
      public void recordingStateChanged(Recording changed) {
        if (changed.getId() != owned.getId() && changed.getState() == RecordingState.RUNNING)
          foreign.set(true);
      }
    };
  }

  private void rejectForeign(Recording owned) {
    scanForeign(owned);
    if (foreign.get()) throw new IllegalStateException("foreign active or delayed JFR recording");
  }

  private void scanForeign(Recording owned) {
    for (var recording : FlightRecorder.getFlightRecorder().getRecordings()) {
      if (recording.getId() != owned.getId()
          && (recording.getState() == RecordingState.RUNNING
              || recording.getState() == RecordingState.DELAYED)) foreign.set(true);
    }
  }

  private void awaitStop(Recording recording) throws Exception {
    while (recording.getState() == RecordingState.RUNNING) {
      if (requests.poll(100, TimeUnit.MILLISECONDS) == Request.STOP) return;
      scanForeign(recording);
      if (foreign.get()) return;
    }
  }

  private Detail describe(
      Recording recording,
      DiagnosticJfrSettings.Settings settings,
      DiagnosticJfrFiles.Export exported) {
    return new Detail(
        recording.getId(),
        String.valueOf(recording.getStartTime()),
        String.valueOf(recording.getStopTime()),
        settings.originalSha256(),
        settings.appliedSha256(),
        Map.copyOf(recording.getSettings()),
        binding.attempt() + "/capture.jfr",
        exported);
  }
}
