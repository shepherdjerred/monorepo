package com.shepherdjerred.thestorm.rwf;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.rwf.adapter.content.ContentFiles;
import com.shepherdjerred.thestorm.rwf.adapter.content.RwfConfig;
import com.shepherdjerred.thestorm.rwf.adapter.db.JooqMatchStore;
import com.shepherdjerred.thestorm.rwf.adapter.db.JooqSnapshotStore;
import com.shepherdjerred.thestorm.rwf.adapter.paper.RwfPaper;
import com.shepherdjerred.thestorm.rwf.adapter.paper.ServerHooks;
import com.shepherdjerred.thestorm.rwf.adapter.record.GzipRecorder;
import com.shepherdjerred.thestorm.rwf.adapter.record.Retention;
import com.shepherdjerred.thestorm.rwf.adapter.remote.FliptRwfGate;
import com.shepherdjerred.thestorm.rwf.app.CombatantActions;
import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchRecording;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.PayoutService;
import com.shepherdjerred.thestorm.rwf.app.Pseudonyms;
import com.shepherdjerred.thestorm.rwf.app.Recorder;
import com.shepherdjerred.thestorm.rwf.app.RecordingSummary;
import com.shepherdjerred.thestorm.rwf.domain.record.Frame;
import com.shepherdjerred.thestorm.rwf.domain.record.InputFrame;
import com.shepherdjerred.thestorm.rwf.domain.record.Intent;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEnd;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEvent;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordHeader;
import java.net.URI;
import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import org.bukkit.Bukkit;
import org.jspecify.annotations.Nullable;

/**
 * Red Warfare Search and Destroy. Loads {@code rwf.yml}, the kits and the maps, migrates its
 * tables, replays payouts a crash left in the outbox, prunes old recordings, then wires the Paper
 * side over the sealed world and publishes {@link MatchView}, {@link MatchEvents} and {@link
 * CombatantActions} for the bots module. The economy module must be enabled first; the configured
 * world must be loaded already.
 */
public final class RwfModule implements StormModule {

  /** How long disabling waits for the recorder to flush. */
  static final Duration RECORDER_FLUSH = Duration.ofSeconds(5);

  /**
   * What tests replace.
   *
   * @param env reads environment variables
   * @param gate the join gate; empty means the Flipt gate from {@code FLIPT_URL} and {@code
   *     FLIPT_ENVIRONMENT}
   * @param server the server operations tests replace; empty means the real server's
   */
  public record Hooks(
      Function<String, Optional<String>> env,
      Optional<JoinGate> gate,
      Optional<ServerHooks> server) {

    public static Hooks production() {
      return new Hooks(
          name -> Optional.ofNullable(System.getenv(name)), Optional.empty(), Optional.empty());
    }
  }

  private final Hooks hooks;
  private @Nullable RwfPaper paper;
  private @Nullable Recorder recorder;
  private @Nullable FliptRwfGate flipt;

  public RwfModule() {
    this(Hooks.production());
  }

  public RwfModule(Hooks hooks) {
    this.hooks = hooks;
  }

  @Override
  public String id() {
    return "rwf";
  }

  @Override
  public void enable(ModuleContext context) {
    var content = ContentFiles.load(context.dataDirectory(), Bukkit::createBlockData);
    var config = content.config();
    context.database().migrate(id(), getClass().getClassLoader());
    var matches = new JooqMatchStore(context.database());
    var payouts =
        new PayoutService(
            context.services().require(Wallets.class),
            matches,
            new PayoutService.Settings(config.rewards().dailyCap(), config.rewards().zone()),
            context.time());
    replayPayouts(context, payouts);
    var pseudonyms = pseudonyms(config);
    var recording = recorder(context, config, pseudonyms.isPresent());
    recorder = recording;
    var started =
        RwfPaper.start(
            context,
            content,
            new RwfPaper.App(
                new JooqSnapshotStore(context.database()),
                matches,
                payouts,
                recording,
                pseudonyms,
                gate(context, config),
                hooks
                    .server()
                    .orElseGet(
                        () ->
                            ServerHooks.production(
                                context.services().require(ChunkTickets.class)))));
    paper = started;
    context.services().provide(MatchView.class, started.view());
    context.services().provide(MatchEvents.class, started.events());
    context.services().provide(CombatantActions.class, started.actions());
    context
        .logger()
        .info(
            "rwf: {} kits, {} maps, world {}, recording {}",
            content.kits().size(),
            content.maps().size(),
            config.world(),
            pseudonyms.isPresent() ? "on" : "off");
  }

  private static void replayPayouts(ModuleContext context, PayoutService payouts) {
    var _ =
        payouts
            .replay()
            .whenComplete(
                (paid, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not replay rwf payouts", failure);
                  } else if (!paid.isEmpty()) {
                    context
                        .logger()
                        .info("Replayed {} rwf payouts left by the last run", paid.size());
                  }
                });
  }

  private Optional<Pseudonyms> pseudonyms(RwfConfig config) {
    if (!config.recording().enabled()) {
      return Optional.empty();
    }
    var variable = config.recording().saltEnv();
    var salt =
        hooks
            .env()
            .apply(variable)
            .filter(value -> !value.isBlank())
            .orElseThrow(() -> missingSalt(variable));
    return Optional.of(new Pseudonyms(salt));
  }

  private static Recorder recorder(ModuleContext context, RwfConfig config, boolean enabled) {
    if (!enabled) {
      return new NoRecorder();
    }
    var recorder =
        new GzipRecorder(
            context.dataDirectory(),
            config.recording().directory(),
            context.compute(),
            context.time());
    var now = context.time().instant();
    var _ =
        context
            .compute()
            .submit(
                () ->
                    Retention.prune(
                        recorder.root(),
                        Duration.ofDays(config.recording().retentionDays()),
                        config.recording().maxBytes(),
                        now))
            .whenComplete(
                (report, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not prune rwf recordings", failure);
                  } else if (report.deleted() > 0) {
                    context.logger().info("Pruned {} old rwf recordings", report.deleted());
                  }
                });
    return recorder;
  }

  /** The join gate: the test hook, or Flipt from the environment, closed when unset. */
  private JoinGate gate(ModuleContext context, RwfConfig config) {
    if (hooks.gate().isPresent()) {
      return hooks.gate().orElseThrow();
    }
    var base = hooks.env().apply("FLIPT_URL").filter(v -> !v.isBlank());
    var environment = hooks.env().apply("FLIPT_ENVIRONMENT").filter(v -> !v.isBlank());
    if (base.isEmpty() || environment.isEmpty()) {
      context
          .logger()
          .warn("FLIPT_URL or FLIPT_ENVIRONMENT is unset; /rwf join stays closed to everyone");
      return player -> CompletableFuture.completedFuture(false);
    }
    var gate =
        new FliptRwfGate(URI.create(base.orElseThrow()), environment.orElseThrow(), config.world());
    flipt = gate;
    return gate;
  }

  @Override
  public void disable() {
    if (paper != null) {
      paper.stop();
      paper = null;
    }
    var current = recorder;
    if (current != null) {
      recorder = null;
      try {
        current
            .close(RECORDER_FLUSH)
            .orTimeout(RECORDER_FLUSH.toMillis(), TimeUnit.MILLISECONDS)
            .join();
      } catch (CompletionException e) {
        // Disabling must finish; the lost recording is the only casualty.
        Bukkit.getLogger().warning("rwf recordings did not flush in time: " + e.getMessage());
      }
    }
    if (flipt != null) {
      flipt.close();
      flipt = null;
    }
  }

  private static IllegalStateException missingSalt(String variable) {
    return new IllegalStateException(
        String.format(
            "rwf recording is enabled but %s is not set; set it or turn recording.enabled off",
            variable));
  }

  /** The recorder used when recording is off: accepts everything, writes nothing. */
  static final class NoRecorder implements Recorder {

    @Override
    public MatchRecording begin(RecordHeader header) {
      return new MatchRecording() {
        @Override
        public void event(RecordEvent event) {}

        @Override
        public void frame(Frame frame) {}

        @Override
        public void input(InputFrame input) {}

        @Override
        public void intent(Intent intent) {}

        @Override
        public CompletableFuture<RecordingSummary> end(RecordEnd end) {
          return CompletableFuture.completedFuture(RecordingSummary.NONE);
        }
      };
    }

    @Override
    public CompletableFuture<Void> close(Duration timeout) {
      return CompletableFuture.completedFuture(null);
    }
  }
}
