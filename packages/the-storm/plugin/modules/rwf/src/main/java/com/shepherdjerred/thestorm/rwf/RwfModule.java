package com.shepherdjerred.thestorm.rwf;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.rwf.adapter.content.ContentFiles;
import com.shepherdjerred.thestorm.rwf.adapter.content.MapSource;
import com.shepherdjerred.thestorm.rwf.adapter.content.RwfConfig;
import com.shepherdjerred.thestorm.rwf.adapter.db.JooqKitStore;
import com.shepherdjerred.thestorm.rwf.adapter.db.JooqMatchStore;
import com.shepherdjerred.thestorm.rwf.adapter.db.JooqSnapshotStore;
import com.shepherdjerred.thestorm.rwf.adapter.db.JooqStatsStore;
import com.shepherdjerred.thestorm.rwf.adapter.discord.RwfDiscordPosts;
import com.shepherdjerred.thestorm.rwf.adapter.discord.RwfStatsCommand;
import com.shepherdjerred.thestorm.rwf.adapter.paper.RwfPaper;
import com.shepherdjerred.thestorm.rwf.adapter.paper.RwfWorlds;
import com.shepherdjerred.thestorm.rwf.adapter.paper.ServerHooks;
import com.shepherdjerred.thestorm.rwf.adapter.record.GzipRecorder;
import com.shepherdjerred.thestorm.rwf.adapter.record.Retention;
import com.shepherdjerred.thestorm.rwf.adapter.remote.FliptPlayerFlag;
import com.shepherdjerred.thestorm.rwf.adapter.remote.FliptRwfFeatures;
import com.shepherdjerred.thestorm.rwf.adapter.remote.FliptRwfGate;
import com.shepherdjerred.thestorm.rwf.adapter.remote.FliptRwfKillstreaksGate;
import com.shepherdjerred.thestorm.rwf.adapter.remote.FliptRwfKitsGate;
import com.shepherdjerred.thestorm.rwf.app.CombatantActions;
import com.shepherdjerred.thestorm.rwf.app.FeatureGates;
import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchRecording;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.PayoutService;
import com.shepherdjerred.thestorm.rwf.app.Pseudonyms;
import com.shepherdjerred.thestorm.rwf.app.Recorder;
import com.shepherdjerred.thestorm.rwf.app.RecordingSummary;
import com.shepherdjerred.thestorm.rwf.app.RwfFeatures;
import com.shepherdjerred.thestorm.rwf.app.shop.KitShop;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import com.shepherdjerred.thestorm.rwf.domain.record.Frame;
import com.shepherdjerred.thestorm.rwf.domain.record.InputFrame;
import com.shepherdjerred.thestorm.rwf.domain.record.Intent;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEnd;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEvent;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordHeader;
import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.bukkit.Bukkit;
import org.jspecify.annotations.Nullable;

/**
 * Red Warfare Search and Destroy. Loads {@code rwf.yml}, the kits and the maps, migrates its
 * tables, replays payouts a crash left in the outbox, prunes old recordings, then wires the Paper
 * side over the sealed world and publishes {@link MatchView}, {@link MatchEvents} and {@link
 * CombatantActions} for the bots module. When the discord module is on, lobbies and results are
 * announced there. The economy module must be enabled first; the configured map world must be
 * loaded already. RWF creates or loads its explicitly owned void lobby before starting gameplay.
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
   * @param features the match feature flags; empty means Flipt from {@code FLIPT_URL} and {@code
   *     FLIPT_ENVIRONMENT}, every feature off when they are unset
   * @param kitGates the per-player kit and killstreak gates; empty means their Flipt flags, read
   *     the same way
   */
  public record Hooks(
      Function<String, Optional<String>> env,
      Optional<JoinGate> gate,
      Optional<ServerHooks> server,
      Optional<RwfFeatures.Source> features,
      Optional<FeatureGates> kitGates) {

    public static Hooks production() {
      return new Hooks(
          name -> Optional.ofNullable(System.getenv(name)),
          Optional.empty(),
          Optional.empty(),
          Optional.empty(),
          Optional.empty());
    }
  }

  private final Hooks hooks;
  private @Nullable RwfPaper paper;
  private @Nullable Recorder recorder;
  private @Nullable FliptRwfGate flipt;
  private final List<FliptPlayerFlag> featureFlags = new ArrayList<>();
  private MatchEvents.@Nullable Subscription discordPosts;
  private RwfFeatures.@Nullable Source features;

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
    var content = ContentFiles.catalog(context.dataDirectory(), Bukkit::createBlockData);
    var lobby =
        RwfWorlds.prepare(
            context.plugin().getServer(),
            content.config().worlds(),
            context.services().require(SealedWorlds.class),
            context.random());
    context.logger().info("rwf: owned lobby {} uuid={}", lobby.getName(), lobby.getUID());
    var resources = new com.shepherdjerred.thestorm.rwf.app.map.MapResourceRegistry();
    context
        .services()
        .provide(com.shepherdjerred.thestorm.rwf.app.map.MapResources.class, resources);
    var config = content.config();
    context.database().migrate(id(), getClass().getClassLoader());
    var reset = new com.shepherdjerred.thestorm.rwf.adapter.db.JooqPlayerReset(context.database());
    context
        .services()
        .require(com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry.class)
        .register(id(), reset::reset);
    var matches = new JooqMatchStore(context.database());
    var wallets = context.services().require(Wallets.class);
    var payouts = new PayoutService(wallets, matches, context.time());
    replayPayouts(context, payouts);
    var random = context.random();
    var shop =
        new KitShop(
            wallets,
            new JooqKitStore(context.database()),
            () -> new UUID(random.nextLong(), random.nextLong()));
    replayPurchases(context, shop);
    var pseudonyms = pseudonyms(config);
    var recording = recorder(context, config, pseudonyms.isPresent());
    recorder = recording;
    var started =
        RwfPaper.start(
            context,
            content,
            resources,
            new RwfPaper.App(
                new JooqSnapshotStore(context.database()),
                matches,
                payouts,
                recording,
                pseudonyms,
                gate(context, config),
                kitGates(context, config),
                shop,
                hooks
                    .server()
                    .orElseGet(
                        () ->
                            ServerHooks.production(context.services().require(ChunkTickets.class))),
                features(context, config),
                new JooqStatsStore(context.database()),
                new com.shepherdjerred.thestorm.rwf.adapter.db.JooqQuarantineStore(
                    context.database()),
                new com.shepherdjerred.thestorm.rwf.adapter.db.JooqStreakStore(
                    context.database())));
    paper = started;
    context
        .services()
        .provide(com.shepherdjerred.thestorm.rwf.app.map.MapLoading.class, started.loading());
    context.services().provide(MatchView.class, started.view());
    context
        .services()
        .find(com.shepherdjerred.thestorm.core.safety.ContentSafety.class)
        .ifPresent(
            safety ->
                safety.evidenceContext(
                    "rwf",
                    player ->
                        started
                            .view()
                            .current()
                            .map(
                                match ->
                                    "match="
                                        + match.matchId()
                                        + " map="
                                        + match.mapId()
                                        + " phase="
                                        + match.phase()
                                        + " fighter="
                                        + match.combatants().stream()
                                            .filter(fighter -> fighter.id().uuid().equals(player))
                                            .toList()
                                        + " noFallUntil="
                                        + started.view().noFallUntil(player))
                            .orElse("none")));
    context.services().provide(MatchEvents.class, started.events());
    discordPosts =
        context
            .services()
            .find(DiscordRelay.class)
            .map(
                relay ->
                    new RwfDiscordPosts(
                        relay,
                        content.maps().stream()
                            .map(MapSource::definition)
                            .collect(
                                Collectors.toUnmodifiableMap(
                                    MapDefinition::id, MapDefinition::name)),
                        context.logger()))
            .map(posts -> started.events().subscribe(posts::accept))
            .orElse(null);
    context
        .services()
        .find(DiscordRelay.class)
        .ifPresent(
            relay ->
                relay.addCommand(
                    new RwfStatsCommand(
                            matches,
                            context.services().require(PlayerDirectory.class),
                            context.logger())
                        .command()));
    context.services().provide(CombatantActions.class, started.actions());
    context
        .services()
        .provide(com.shepherdjerred.thestorm.rwf.app.ShowcaseControl.class, started.showcases());
    context
        .logger()
        .info(
            "rwf: {} kits, {} maps in rotation ({} quarantined: {}), worlds {}, recording {}",
            content.kits().size(),
            content.rotation().size(),
            config.quarantine().size(),
            config.quarantine().keySet(),
            config.worlds(),
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

  private static void replayPurchases(ModuleContext context, KitShop shop) {
    var _ =
        shop.replay(context.time().instant())
            .whenComplete(
                (settled, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not settle pending rwf kit purchases", failure);
                  } else if (!settled.isEmpty()) {
                    context
                        .logger()
                        .info(
                            "Settled {} rwf kit purchases left pending by the last run",
                            settled.size());
                  }
                });
  }

  /**
   * The kit and killstreak gates: the test hook, or their Flipt flags from the environment, off for
   * everyone when unset.
   */
  private FeatureGates kitGates(ModuleContext context, RwfConfig config) {
    if (hooks.kitGates().isPresent()) {
      return hooks.kitGates().orElseThrow();
    }
    var base = hooks.env().apply("FLIPT_URL").filter(v -> !v.isBlank());
    var environment = hooks.env().apply("FLIPT_ENVIRONMENT").filter(v -> !v.isBlank());
    if (base.isEmpty() || environment.isEmpty()) {
      context
          .logger()
          .warn(
              "FLIPT_URL or FLIPT_ENVIRONMENT is unset; rwf offers the first four kits and no"
                  + " killstreaks");
      JoinGate closed = player -> CompletableFuture.completedFuture(false);
      return new FeatureGates(closed, closed);
    }
    var uri = URI.create(base.orElseThrow());
    var kits = FliptRwfKitsGate.create(uri, environment.orElseThrow(), config.worlds().maps());
    var killstreaks =
        FliptRwfKillstreaksGate.create(uri, environment.orElseThrow(), config.worlds().maps());
    featureFlags.add(kits);
    featureFlags.add(killstreaks);
    return new FeatureGates(kits, killstreaks);
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
            new GzipRecorder.Parts(
                context.compute(), context.time(), GzipRecorder.Alarms.logging(context.logger())));
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
                  } else {
                    if (report.deleted() > 0) {
                      context.logger().info("Pruned {} archived rwf recordings", report.deleted());
                    }
                    if (report.bytesOverCap() > 0) {
                      context
                          .logger()
                          .warn(
                              "rwf recordings exceed their {}-byte cap by {} bytes; {} are not"
                                  + " archived yet and are kept",
                              config.recording().maxBytes(),
                              report.bytesOverCap(),
                              report.unarchived());
                    }
                  }
                });
    return recorder;
  }

  /** The feature flags: the test hook, or Flipt from the environment, all off when unset. */
  private RwfFeatures.Source features(ModuleContext context, RwfConfig config) {
    if (hooks.features().isPresent()) {
      return hooks.features().orElseThrow();
    }
    var base = hooks.env().apply("FLIPT_URL").filter(v -> !v.isBlank());
    var environment = hooks.env().apply("FLIPT_ENVIRONMENT").filter(v -> !v.isBlank());
    if (base.isEmpty() || environment.isEmpty()) {
      context
          .logger()
          .warn("FLIPT_URL or FLIPT_ENVIRONMENT is unset; every rwf match feature stays off");
      return RwfFeatures.Source.fixed(RwfFeatures.NONE);
    }
    var source =
        new FliptRwfFeatures(
            URI.create(base.orElseThrow()), environment.orElseThrow(), config.worlds().maps());
    features = source;
    return source;
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
        new FliptRwfGate(
            URI.create(base.orElseThrow()), environment.orElseThrow(), config.worlds().maps());
    flipt = gate;
    return gate;
  }

  @Override
  public void disable() {
    if (discordPosts != null) {
      discordPosts.close();
      discordPosts = null;
    }
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
    featureFlags.forEach(FliptPlayerFlag::close);
    featureFlags.clear();
    if (features != null) {
      features.close();
      features = null;
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
        public void observation(
            com.shepherdjerred.thestorm.rwf.domain.record.ObservationFrame observation) {}

        @Override
        public void intent(Intent intent) {}

        @Override
        public void occurrence(
            com.shepherdjerred.thestorm.rwf.domain.record.Occurrence occurrence) {}

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
