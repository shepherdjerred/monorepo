package com.shepherdjerred.thestorm.rwf;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.rwf.adapter.content.ContentFiles;
import com.shepherdjerred.thestorm.rwf.adapter.db.JooqMatchStore;
import com.shepherdjerred.thestorm.rwf.adapter.record.GzipRecorder;
import com.shepherdjerred.thestorm.rwf.adapter.record.Retention;
import com.shepherdjerred.thestorm.rwf.app.PayoutService;
import com.shepherdjerred.thestorm.rwf.app.Pseudonyms;
import java.time.Duration;
import java.util.Optional;
import java.util.function.Function;
import org.bukkit.Bukkit;

/**
 * Red Warfare Search and Destroy. Loads {@code rwf.yml}, the kits and the maps, migrates its
 * tables, replays payouts a crash left in the outbox, and prunes old recordings. The match runner
 * itself (the Paper adapter) is wired in a later step.
 */
public final class RwfModule implements StormModule {

  private final Function<String, Optional<String>> env;

  public RwfModule() {
    this(name -> Optional.ofNullable(System.getenv(name)));
  }

  /** For tests, which supply the recording salt without touching the process environment. */
  RwfModule(Function<String, Optional<String>> env) {
    this.env = env;
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
    if (config.recording().enabled()) {
      var saltEnv = config.recording().saltEnv();
      var salt =
          env.apply(saltEnv)
              .filter(value -> !value.isBlank())
              .orElseThrow(() -> missingSalt(saltEnv));
      var _ = new Pseudonyms(salt);
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
    }
    context
        .logger()
        .info(
            "rwf: loaded {} kits and {} maps for world {}",
            content.kits().size(),
            content.maps().size(),
            config.world());
  }

  private static IllegalStateException missingSalt(String variable) {
    return new IllegalStateException(
        String.format(
            "rwf recording is enabled but %s is not set; set it or turn recording.enabled off",
            variable));
  }
}
