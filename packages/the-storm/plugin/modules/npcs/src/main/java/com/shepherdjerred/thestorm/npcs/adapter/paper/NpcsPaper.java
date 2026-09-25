package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import com.shepherdjerred.thestorm.npcs.app.ActionRegistry;
import com.shepherdjerred.thestorm.npcs.app.ContentSource;
import com.shepherdjerred.thestorm.npcs.app.DialogPresenter;
import com.shepherdjerred.thestorm.npcs.app.DialogueRegistry;
import com.shepherdjerred.thestorm.npcs.app.MarkerService;
import com.shepherdjerred.thestorm.npcs.app.NpcCatalog;
import com.shepherdjerred.thestorm.npcs.app.NpcTalk;
import com.shepherdjerred.thestorm.npcs.app.Trainer;
import com.shepherdjerred.thestorm.npcs.domain.config.NpcsConfig;
import com.shepherdjerred.thestorm.npcs.domain.movement.PathFollower;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.concurrent.Executor;
import java.util.function.Supplier;
import org.bukkit.Registry;

/**
 * Hooks the NPCs into Paper: reconciles the Mannequins, starts the per-tick walker, and registers
 * the listener and {@code /npc}.
 */
public final class NpcsPaper {

  private static final Duration TICK = Duration.ofMillis(50);

  private NpcsPaper() {}

  /**
   * What the app layer built.
   *
   * @param source reads the content files again for {@code /npc reload}: called on the main thread
   *     (to snapshot the loaded worlds), and the source it returns runs on {@code reader}
   * @param reader where content files are read, off the main thread
   */
  public record Parts(
      NpcCatalog catalog,
      DialogueRegistry dialogues,
      ActionRegistry actions,
      Trainer trainer,
      Supplier<ContentSource> source,
      Executor reader) {}

  /**
   * The Paper services that are swapped out in tests, where MockBukkit does not implement them.
   *
   * @param tickets the NPC chunk holds, on core's shared chunk tickets
   * @param presenter the dialog renderer
   */
  public record Hooks(HeldChunks tickets, DialogPresenter presenter) {

    /** The real ones. */
    public static Hooks paper(ModuleContext context, NpcsConfig config) {
      var server = context.plugin().getServer();
      return new Hooks(
          HeldChunks.paper(server, context.services().require(ChunkTickets.class)),
          new PaperDialogPresenter(
              server, context.scheduler(), Duration.ofMinutes(config.dialog().lifetimeMinutes())));
    }
  }

  /** What is running, for other modules and for shutdown. */
  public record Installed(MarkerService markers, Cancellable shutdown) {}

  public static Installed install(
      ModuleContext context, NpcsConfig config, Parts parts, Hooks hooks) {
    var plugin = context.plugin();
    var server = plugin.getServer();
    var keys = NpcKeys.of(plugin);
    var navigatorType =
        Registry.ENTITY_TYPE.getOrThrow(Mannequins.requireKey(config.navigator().entity()));
    var navigators =
        new Navigators(
            server, keys, Navigators.mobClass(navigatorType), config.navigator().followRange());
    var world =
        new NpcWorld(
            new NpcWorld.Parts(
                server,
                new Mannequins(server, keys),
                navigators,
                hooks.tickets(),
                context.logger()),
            parts.catalog(),
            config,
            new PathFollower(config.movement(), context.random()));
    var displays = new MarkerEntities(plugin, keys, config.markers(), world::location);
    var markers = new MarkerService(parts.catalog(), displays);
    world.attach(displays, markers);
    var talk =
        new NpcTalk(
            new NpcTalk.Wiring(
                parts.catalog(),
                parts.dialogues(),
                parts.actions(),
                hooks.presenter(),
                config.dialog().continueLabel(),
                context.time(),
                Duration.ofSeconds(config.dialog().holdSeconds()),
                context.logger()),
            parts.trainer());
    world.attachListeners(talk::listeners);
    context.logger().info("NPCs: {}", world.reconcile());
    server
        .getPluginManager()
        .registerEvents(new NpcListener(world, talk, markers, server.getPluginManager()), plugin);
    var ticker = context.scheduler().repeatOnMainThread(TICK, TICK, world::tick);
    var commands =
        new NpcCommands(
            new NpcCommands.Wiring(
                parts.catalog(),
                world,
                parts.actions(),
                parts.source(),
                parts.reader(),
                context.scheduler().mainThread(),
                context.logger()));
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
    return new Installed(
        markers,
        () -> {
          ticker.cancel();
          world.shutdown();
        });
  }
}
