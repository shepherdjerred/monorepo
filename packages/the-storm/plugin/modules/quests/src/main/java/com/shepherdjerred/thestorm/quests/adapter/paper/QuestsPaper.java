package com.shepherdjerred.thestorm.quests.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.npcs.app.NpcActions;
import com.shepherdjerred.thestorm.npcs.app.NpcDialogs;
import com.shepherdjerred.thestorm.npcs.app.NpcDirectory;
import com.shepherdjerred.thestorm.npcs.app.NpcMarkers;
import com.shepherdjerred.thestorm.quests.app.QuestService;
import com.shepherdjerred.thestorm.quests.app.QuestWorld;
import com.shepherdjerred.thestorm.quests.domain.config.QuestsConfig;
import com.shepherdjerred.thestorm.quests.domain.content.QuestContent;
import com.shepherdjerred.thestorm.quests.domain.view.Journal;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.function.BiConsumer;
import org.bukkit.entity.Player;

/** Wires the quests module into Paper: the world, NPCs, listeners, commands and the tick. */
public final class QuestsPaper {

  /** Milliseconds per server tick. */
  private static final long TICK_MILLIS = 50;

  /** The ports quests use from other modules. */
  public record Ports(
      TrackLevels tracks,
      Protection protection,
      NpcDirectory npcs,
      NpcDialogs dialogs,
      NpcActions actions,
      NpcMarkers markers,
      PlayerDirectory players) {}

  private final ModuleContext context;
  private final QuestsConfig config;
  private final Ports ports;
  private final SidebarDisplay sidebars;

  public QuestsPaper(ModuleContext context, QuestsConfig config, Ports ports) {
    this(context, config, ports, new Sidebars(context.plugin().getServer()));
  }

  QuestsPaper(ModuleContext context, QuestsConfig config, Ports ports, SidebarDisplay sidebars) {
    this.context = context;
    this.config = config;
    this.ports = ports;
    this.sidebars = sidebars;
  }

  /** The world the service acts on. */
  public QuestWorld world(QuestContent content) {
    return new PaperWorld(
        new PaperWorld.Parts(
            context.plugin().getServer(),
            context.scheduler(),
            content,
            ports.tracks(),
            ports.protection(),
            ports.npcs(),
            ports.markers(),
            sidebars,
            config.mainWorld(),
            Duration.ofSeconds(config.spawnedMobSeconds())));
  }

  /** The journal as a dialog (runtime dialogs are not in MockBukkit). */
  public BiConsumer<Player, Journal.View> dialogJournal(QuestService service) {
    return new JournalDialog(context.plugin().getServer(), context.scheduler(), service)::show;
  }

  /**
   * Registers listeners, commands, NPC hooks and the refresh tick. Returns the tick, to cancel on
   * disable.
   */
  public Cancellable install(QuestService service, BiConsumer<Player, Journal.View> journal) {
    var server = context.plugin().getServer();
    server
        .getPluginManager()
        .registerEvents(
            new QuestListener(service, service.content(), sidebars, config), context.plugin());
    var commands =
        new QuestCommands(
            new QuestCommands.Wiring(
                service,
                journal,
                ports.players(),
                context.scheduler().mainThread(),
                context.logger(),
                config.mainWorld()));
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
    NpcBridge.install(ports.dialogs(), ports.actions(), service, config);
    // Players already online (after a reload) load their quests too.
    for (var player : server.getOnlinePlayers()) {
      var _ = service.join(player.getUniqueId());
    }
    var period = Duration.ofMillis(config.refreshTicks() * TICK_MILLIS);
    return context.scheduler().repeatOnMainThread(period, period, service::tick);
  }
}
