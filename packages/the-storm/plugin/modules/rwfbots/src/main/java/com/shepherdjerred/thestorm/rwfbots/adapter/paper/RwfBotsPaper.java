package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.rwf.app.BotActions;
import com.shepherdjerred.thestorm.rwf.app.BotRoster;
import com.shepherdjerred.thestorm.rwf.app.CombatantActions;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.RwfBotsConfig;
import com.shepherdjerred.thestorm.rwfbots.adapter.record.GzipTraceFiles;
import com.shepherdjerred.thestorm.rwfbots.app.ChatGate;
import com.shepherdjerred.thestorm.rwfbots.app.DecisionGate;
import com.shepherdjerred.thestorm.rwfbots.app.Governor;
import com.shepherdjerred.thestorm.rwfbots.app.LobbyLoop;
import com.shepherdjerred.thestorm.rwfbots.app.NavCatalog;
import com.shepherdjerred.thestorm.rwfbots.app.PersonalityStatsStore;
import com.shepherdjerred.thestorm.rwfbots.app.StatsCache;
import com.shepherdjerred.thestorm.rwfbots.app.ThinkLoop;
import com.shepherdjerred.thestorm.rwfbots.app.TraceSink;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.PersonalityCatalog;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.Optional;
import java.util.function.Supplier;
import org.bukkit.World;
import org.bukkit.event.HandlerList;

/**
 * Wires the bots into Paper: the roster rwf fills matches from, the match bridge, the stimulus
 * listener, the 1-tick ticker, bot chat and the debug command, over the think loop and the
 * governor.
 */
public final class RwfBotsPaper {

  private static final Duration TICK = Duration.ofMillis(50);

  private final ModuleContext context;
  private final Roster roster;
  private final ThinkLoop loop;
  private final MatchBridge bridge;
  private final StimulusCollector stimuli;
  private final Cancellable clock;
  private final RwfBotsCommand command;
  private final Optional<GzipTraceFiles> traces;
  private final Optional<BotChat> chat;
  private final Optional<LobbyChatListener> heard;

  private RwfBotsPaper(Parts parts) {
    this.context = parts.context();
    this.roster = parts.roster();
    this.loop = parts.loop();
    this.bridge = parts.bridge();
    this.stimuli = parts.stimuli();
    this.clock = parts.clock();
    this.command = parts.command();
    this.traces = parts.traces();
    this.chat = parts.chat();
    this.heard = parts.heard();
  }

  private record Parts(
      ModuleContext context,
      Roster roster,
      ThinkLoop loop,
      MatchBridge bridge,
      StimulusCollector stimuli,
      Cancellable clock,
      RwfBotsCommand command,
      Optional<GzipTraceFiles> traces,
      Optional<BotChat> chat,
      Optional<LobbyChatListener> heard) {}

  /**
   * What the module loaded before wiring.
   *
   * @param config {@code rwfbots.yml}
   * @param personalities the catalog
   * @param nav the nav artifacts
   * @param stats the cached records
   * @param store where records are written
   * @param bodies the bodies bots inhabit
   * @param world the match world
   * @param tickTimes the server's recent tick times in nanoseconds, for the governor
   * @param chatGate the managed flag that gates bot chat; unused when chat is disabled
   * @param lobby the lobby's baked navigation
   */
  public record App(
      RwfBotsConfig config,
      PersonalityCatalog personalities,
      NavCatalog nav,
      StatsCache stats,
      PersonalityStatsStore store,
      Bodies bodies,
      World world,
      Supplier<long[]> tickTimes,
      ChatGate chatGate,
      NavArtifact lobby) {}

  /** Starts the Paper side; rwf's ports must already be published. */
  public static RwfBotsPaper start(ModuleContext module, App app) {
    var services = module.services();
    var view = services.require(MatchView.class);
    var events = services.require(MatchEvents.class);
    var actions = BotActions.over(services.require(CombatantActions.class), view);
    var governor = new Governor(app.config().governor().toSettings());
    var traces =
        app.config().traces().enabled()
            ? Optional.of(
                new GzipTraceFiles(
                    module.dataDirectory(),
                    app.config().traces().directory(),
                    module.compute(),
                    app.config().traces().queueCapacity()))
            : Optional.<GzipTraceFiles>empty();
    var loop =
        new ThinkLoop(
            new ThinkLoop.Parts(
                module.compute(),
                app.config().thinkRates(),
                governor,
                traces.<TraceSink>map(t -> t).orElseGet(TraceSink::none),
                System::nanoTime));
    var roster =
        new Roster(
            new Roster.Parts(
                module.plugin().getServer(),
                view,
                app.bodies(),
                app.personalities(),
                app.stats(),
                app.nav(),
                governor,
                app.config(),
                module.random(),
                module.logger()));
    var stimuli = new StimulusCollector();
    // Lobby bodies never use a kit ability, so nothing reports a Rewind landing from here.
    var lobby =
        new LobbyTicker(
            new LobbyTicker.Parts(
                roster,
                new LobbyLoop(module.compute()),
                app.lobby(),
                new BodyDriver(
                    new BodyDriver.Parts(app.bodies(), actions, app.world(), stimuli, bot -> {})),
                actions,
                app.config(),
                module.time(),
                module.logger()));
    var bridge =
        new MatchBridge(
            new MatchBridge.Parts(
                roster,
                loop,
                actions,
                app.nav(),
                app.stats(),
                app.store(),
                traces,
                app.world(),
                stimuli,
                module.time(),
                module.logger(),
                lobby));
    var driver =
        new BodyDriver(
            new BodyDriver.Parts(app.bodies(), actions, app.world(), stimuli, bridge::rewound));
    var ticker =
        new BotTicker(
            new BotTicker.Parts(
                roster,
                loop,
                governor,
                new DecisionGate(app.config().think().maxDecisionAgeTicks()),
                driver,
                view,
                app.tickTimes(),
                System::nanoTime,
                lobby));
    module.plugin().getServer().getPluginManager().registerEvents(stimuli, module.plugin());
    bridge.subscribe(events);
    var command = new RwfBotsCommand(roster, loop, governor, ticker);
    command.registerPermission(module.plugin().getServer().getPluginManager());
    module
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> command.register(event.registrar()));
    var clock = module.scheduler().repeatOnMainThread(TICK, TICK, ticker::run);
    var chatConfig = app.config().chat();
    var chat =
        chatConfig.enabled()
            ? Optional.of(
                new BotChat(
                    new BotChat.Parts(
                        chatConfig.toSettings(),
                        Duration.ofSeconds(chatConfig.flagRefreshSeconds()),
                        app.chatGate(),
                        roster,
                        app.world(),
                        module.scheduler(),
                        module.time(),
                        module.logger())))
            : Optional.<BotChat>empty();
    chat.ifPresent(talk -> talk.start(events));
    var heard = chat.map(talk -> new LobbyChatListener(talk, module.scheduler()));
    heard.ifPresent(
        listener ->
            module
                .plugin()
                .getServer()
                .getPluginManager()
                .registerEvents(listener, module.plugin()));
    services.provide(BotRoster.class, BotRoster.of(roster));
    return new RwfBotsPaper(
        new Parts(module, roster, loop, bridge, stimuli, clock, command, traces, chat, heard));
  }

  public Roster roster() {
    return roster;
  }

  public ThinkLoop loop() {
    return loop;
  }

  /** Bot chat, when {@code chat.enabled}. */
  public Optional<BotChat> chat() {
    return chat;
  }

  /** Stops the ticker and the loop, despawns every bot and closes the trace file. */
  public void stop() {
    clock.cancel();
    bridge.close();
    heard.ifPresent(HandlerList::unregisterAll);
    chat.ifPresent(BotChat::close);
    HandlerList.unregisterAll(stimuli);
    command.unregisterPermission(context.plugin().getServer().getPluginManager());
    loop.close();
    roster.clear();
    traces.ifPresent(
        files -> {
          var _ =
              files
                  .end()
                  .whenComplete(
                      (dropped, failure) -> {
                        if (failure != null) {
                          context
                              .logger()
                              .error("rwfbots: could not close the trace file", failure);
                        }
                      });
        });
  }
}
