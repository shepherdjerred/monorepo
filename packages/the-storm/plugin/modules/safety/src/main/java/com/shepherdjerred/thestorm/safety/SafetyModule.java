package com.shepherdjerred.thestorm.safety;

import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.safety.ContentSafety;
import com.shepherdjerred.thestorm.safety.adapter.db.JooqEvidenceStore;
import com.shepherdjerred.thestorm.safety.adapter.grim.GrimHooks;
import com.shepherdjerred.thestorm.safety.adapter.http.HttpContentClassifier;
import com.shepherdjerred.thestorm.safety.adapter.paper.ActivityJournal;
import com.shepherdjerred.thestorm.safety.adapter.paper.EvidenceCommands;
import com.shepherdjerred.thestorm.safety.adapter.paper.NameGate;
import com.shepherdjerred.thestorm.safety.adapter.paper.TextGate;
import com.shepherdjerred.thestorm.safety.adapter.paper.WrittenContentGate;
import com.shepherdjerred.thestorm.safety.app.SafetyConfig;
import com.shepherdjerred.thestorm.safety.app.SafetyService;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import org.jspecify.annotations.Nullable;

/** Runs before chat so every player-controlled publication has one admission and evidence owner. */
public final class SafetyModule implements StormModule {
  private @Nullable HttpContentClassifier classifier;
  private @Nullable GrimHooks grim;

  @Override
  public String id() {
    return "safety";
  }

  @Override
  public void enable(ModuleContext context) {
    if (!context.plugin().getServer().getPluginManager().isPluginEnabled("GrimAC"))
      throw new IllegalStateException("Safety requires the pinned GrimAC plugin");
    var config = context.loadConfig("safety.yml", SafetyConfig.class);
    var token = System.getenv(config.tokenEnvironment());
    if (token == null || token.isBlank())
      throw new IllegalStateException("Safety bearer credential is required");
    var client = new HttpContentClassifier(config.brainUrl(), token, config.requestTimeoutMillis());
    classifier = client;
    context.database().migrate(id(), getClass().getClassLoader());
    var store = new JooqEvidenceStore(context.database());
    var _ =
        store
            .recover(context.time().instant())
            .whenComplete(
                (count, failure) -> {
                  if (failure != null)
                    context.logger().error("Safety evidence recovery failed", failure);
                  else if (count > 0)
                    context
                        .logger()
                        .warn("Recorded {} interrupted evidence submissions; none replayed", count);
                });
    context
        .plugin()
        .getServer()
        .getServicesManager()
        .register(
            com.shepherdjerred.thestorm.core.safety.EvidenceAccess.class,
            new com.shepherdjerred.thestorm.safety.adapter.db.EvidenceQueries(
                context.database(), store, context.time(), context.random()),
            context.plugin(),
            org.bukkit.plugin.ServicePriority.Normal);
    var flags = context.services().require(ManagedGameplay.class);
    var service =
        new SafetyService(
            store,
            client,
            new SafetyService.Policy(
                context.time(),
                config,
                player -> {
                  var cached = flags.cachedEnabled(ManagedGameplay.CONTENT_SAFETY, player);
                  return cached
                      .map(java.util.concurrent.CompletableFuture::completedFuture)
                      .orElseGet(() -> flags.enabled(ManagedGameplay.CONTENT_SAFETY, player));
                }));
    context.services().provide(ContentSafety.class, service);
    grim = new GrimHooks(context, service);
    var manager = context.plugin().getServer().getPluginManager();
    manager.registerEvents(new TextGate(context, service), context.plugin());
    manager.registerEvents(new WrittenContentGate(context, service), context.plugin());
    manager.registerEvents(new NameGate(context, service), context.plugin());
    manager.registerEvents(
        new com.shepherdjerred.thestorm.safety.adapter.paper.CreativeContentGate(context, service),
        context.plugin());
    manager.registerEvents(new ActivityJournal(context, service), context.plugin());
    var existing =
        new com.shepherdjerred.thestorm.safety.adapter.paper.ExistingContentJournal(
            context, service);
    manager.registerEvents(existing, context.plugin());
    existing.loaded();
    var commands = new EvidenceCommands(context, store);
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
  }

  @Override
  public void disable() {
    var hooks = grim;
    if (hooks != null) hooks.close();
    var client = classifier;
    if (client != null) client.close();
  }
}
