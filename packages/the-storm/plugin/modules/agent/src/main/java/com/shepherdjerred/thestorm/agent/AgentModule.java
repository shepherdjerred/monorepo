package com.shepherdjerred.thestorm.agent;

import com.shepherdjerred.thestorm.agent.adapter.db.JooqDecisionLog;
import com.shepherdjerred.thestorm.agent.adapter.http.HttpBrainClient;
import com.shepherdjerred.thestorm.agent.adapter.paper.AgentCommands;
import com.shepherdjerred.thestorm.agent.adapter.paper.AgentJoinListener;
import com.shepherdjerred.thestorm.agent.adapter.paper.AgentRuntime;
import com.shepherdjerred.thestorm.agent.adapter.paper.PaperPlayerContact;
import com.shepherdjerred.thestorm.agent.app.AgentConfig;
import com.shepherdjerred.thestorm.agent.app.AgentServices;
import com.shepherdjerred.thestorm.agent.app.CaseFlow;
import com.shepherdjerred.thestorm.agent.app.ChatFlow;
import com.shepherdjerred.thestorm.agent.app.DecisionLog;
import com.shepherdjerred.thestorm.agent.app.EndorseFlow;
import com.shepherdjerred.thestorm.agent.app.FaqFlow;
import com.shepherdjerred.thestorm.agent.app.FaqMemory;
import com.shepherdjerred.thestorm.agent.app.OverturnFlow;
import com.shepherdjerred.thestorm.agent.app.RecentChat;
import com.shepherdjerred.thestorm.agent.app.SweepFlow;
import com.shepherdjerred.thestorm.agent.app.TriageFlow;
import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.chat.app.GlobalChat;
import com.shepherdjerred.thestorm.chat.app.Subscription;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.essentials.app.ModerationService;
import com.shepherdjerred.thestorm.tickets.app.TicketEvent;
import com.shepherdjerred.thestorm.tickets.app.TicketService;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.net.URI;
import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import java.util.function.Function;
import net.kyori.adventure.text.Component;
import org.jspecify.annotations.Nullable;

/**
 * The AI staff member. Watches chat and new tickets, enforces the ladders, and records every
 * decision. Flow failures are logged, never thrown: a broken flow must not break chat or tickets.
 */
public final class AgentModule implements StormModule {

  private final Function<String, Optional<String>> environment;
  private @Nullable Running running;

  /** Reads the brain token from the process environment. */
  public AgentModule() {
    this(name -> Optional.ofNullable(System.getenv(name)));
  }

  /** Reads the brain token through {@code environment}, for tests. */
  public AgentModule(Function<String, Optional<String>> environment) {
    this.environment = environment;
  }

  @Override
  public String id() {
    return "agent";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("agent.yml", AgentConfig.class);
    context.database().migrate(id(), getClass().getClassLoader());
    var log = new JooqDecisionLog(context.database(), config.serverId());
    context.services().provide(DecisionLog.class, log);
    context.services().provide(AgentConfig.class, config);

    var tickets = context.services().require(TicketService.class);
    var lines = context.services().require(GlobalChat.class);
    var chat = context.services().require(ChatService.class);
    var moderation = context.services().find(ModerationService.class);
    var players = context.services().require(PlayerDirectory.class);

    var brain =
        new HttpBrainClient(
            URI.create(config.brain().baseUrl()),
            bearerToken(config, environment),
            Duration.ofMillis(config.brain().timeoutMs()));

    var services = new AgentServices(brain, log, tickets, context.time(), config, context.random());
    var recents = new RecentChat();
    var chatFlow =
        new ChatFlow(
            recents,
            chat,
            new PaperPlayerContact(context.plugin().getServer(), context.scheduler()),
            services);
    var triageFlow = new TriageFlow(recents, moderation, services);
    var faqFlow = new FaqFlow(new FaqMemory(), services);
    var sweep = new SweepFlow(triageFlow, services);

    Consumer<TicketEvent> ticketListener =
        event -> {
          listen(context, triageFlow.onEvent(event), "agent: working a ticket failed");
          listen(context, faqFlow.onEvent(event), "agent: answering a ticket failed");
        };
    tickets.addListener(ticketListener);
    Subscription subscription =
        lines.subscribe(
            line -> {
              var _ =
                  chatFlow
                      .onChatLine(line)
                      .exceptionally(
                          failure -> {
                            context
                                .logger()
                                .error(Component.text("agent: watching chat failed"), failure);
                            return null;
                          });
            });
    Runnable sweepOnce =
        () -> {
          var _ =
              sweep
                  .sweep()
                  .thenAccept(report -> logSweep(context, report))
                  .exceptionally(
                      failure -> {
                        context
                            .logger()
                            .error(Component.text("agent: sweeping stale tickets failed"), failure);
                        return null;
                      });
        };
    // The boot sweep catches what crashed or slept through triage; the tick repeats it while
    // awake. The sweep itself never blocks: every ticket resolves on worker futures.
    sweepOnce.run();
    var sweepTick =
        context
            .scheduler()
            .repeatOnMainThread(
                Duration.ofMinutes(config.sweep().intervalMinutes()),
                Duration.ofMinutes(config.sweep().intervalMinutes()),
                sweepOnce);
    running = new Running(subscription, tickets, ticketListener, brain, sweepTick);

    context
        .plugin()
        .getServer()
        .getPluginManager()
        .registerEvents(
            new AgentJoinListener(config.onboarding(), context.scheduler()), context.plugin());

    var commands =
        new AgentCommands(
            log,
            players,
            new AgentCommands.AgentFlows(
                sweep,
                new OverturnFlow(services, chat),
                new CaseFlow(services, moderation),
                new EndorseFlow(services),
                faqFlow),
            new AgentRuntime(context.scheduler(), context.logger(), config.serverId()));
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
  }

  @Override
  public void disable() {
    var current = running;
    running = null;
    if (current != null) {
      current.sweepTick().cancel();
      current.subscription().cancel();
      current.tickets().removeListener(current.ticketListener());
      current.brain().close();
    }
  }

  /** Runs a ticket flow, logging its failure instead of breaking tickets. */
  private static void listen(ModuleContext context, CompletableFuture<Void> run, String what) {
    var _ =
        run.exceptionally(
            failure -> {
              context.logger().error(Component.text(what), failure);
              return null;
            });
  }

  /** Logs a sweep report, quietly when nothing happened. */
  private static void logSweep(ModuleContext context, SweepFlow.Report report) {
    if (report.busy()) {
      context.logger().warn(Component.text("agent: sweep skipped, the previous sweep is running"));
    } else if (report.failed() > 0) {
      context
          .logger()
          .warn(
              Component.text(
                  "agent: sweep redrove "
                      + report.redriven()
                      + ", escalated "
                      + report.slaBreached()
                      + ", failed "
                      + report.failed()));
    } else if (report.redriven() > 0 || report.slaBreached() > 0) {
      context
          .logger()
          .info(
              Component.text(
                  "agent: sweep redrove "
                      + report.redriven()
                      + " and escalated "
                      + report.slaBreached()));
    }
  }

  /** The brain token, or a startup failure naming the variable (never the value). */
  static String bearerToken(AgentConfig config, Function<String, Optional<String>> environment) {
    return environment
        .apply(config.brain().bearerTokenEnv())
        .filter(token -> !token.isBlank())
        .orElseThrow(
            () ->
                new IllegalStateException(
                    "The agent module cannot start: "
                        + config.brain().bearerTokenEnv()
                        + " is not set. Wire the secret or switch the module off in config.yml."));
  }

  private record Running(
      Subscription subscription,
      TicketService tickets,
      Consumer<TicketEvent> ticketListener,
      HttpBrainClient brain,
      Cancellable sweepTick) {}
}
