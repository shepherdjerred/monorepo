package com.shepherdjerred.thestorm.agent.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.LongArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.agent.app.CaseFlow;
import com.shepherdjerred.thestorm.agent.app.DecisionLog;
import com.shepherdjerred.thestorm.agent.app.EndorseFlow;
import com.shepherdjerred.thestorm.agent.app.FaqFlow;
import com.shepherdjerred.thestorm.agent.app.OverturnFlow;
import com.shepherdjerred.thestorm.agent.app.SweepFlow;
import com.shepherdjerred.thestorm.agent.domain.AgentDecision;
import com.shepherdjerred.thestorm.core.players.KnownPlayer;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;
import net.kyori.adventure.text.Component;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * {@code /agent}: the agent's recent decisions, for spot-checks, and a manual sweep trigger. Staff
 * only. Shadow rows are what the agent would have done; the rest is what it did.
 */
public final class AgentCommands {

  private static final int LIMIT = 10;
  private static final int NOTE_LENGTH = 120;

  /** The flows the commands trigger. */
  public record AgentFlows(
      SweepFlow sweep, OverturnFlow overturn, CaseFlow cases, EndorseFlow endorse, FaqFlow faq) {}

  private final DecisionLog log;
  private final PlayerDirectory players;
  private final AgentFlows flows;
  private final AgentRuntime runtime;

  /** Open review queues: escalations handed off plus sampled spot-checks. */
  private record Queues(List<Named> escalated, List<Named> sampled) {}

  /** An assembled case with its reporter's display name. */
  private record CasePayload(CaseFlow.CaseView view, String reporter) {}

  public AgentCommands(
      DecisionLog log, PlayerDirectory players, AgentFlows flows, AgentRuntime runtime) {
    this.log = log;
    this.players = players;
    this.flows = flows;
    this.runtime = runtime;
  }

  /** Registers {@code /agent} and {@code /escalations}. */
  public void register(Commands commands) {
    commands.register(agent(), "Inspect the AI staff member");
    commands.register(queue(), "Review cases the AI escalated");
  }

  private LiteralCommandNode<CommandSourceStack> agent() {
    return Commands.literal("agent")
        .requires(source -> source.getSender().hasPermission(AgentPermissions.STAFF))
        .then(
            Commands.literal("decisions")
                .executes(context -> decisions(context, null))
                .then(
                    Commands.argument("player", StringArgumentType.word())
                        .executes(
                            context ->
                                decisions(
                                    context, StringArgumentType.getString(context, "player")))))
        .then(Commands.literal("sweep").executes(this::sweepNow))
        .then(
            Commands.literal("overturn")
                .then(
                    Commands.argument("id", LongArgumentType.longArg(1))
                        .executes(
                            context -> overturn(context, LongArgumentType.getLong(context, "id")))))
        .then(
            Commands.literal("endorse")
                .then(
                    Commands.argument("id", LongArgumentType.longArg(1))
                        .executes(
                            context -> endorse(context, LongArgumentType.getLong(context, "id")))))
        .then(
            Commands.literal("faq")
                .then(
                    Commands.argument("id", LongArgumentType.longArg(1))
                        .executes(
                            context -> faq(context, LongArgumentType.getLong(context, "id"), null))
                        .then(
                            Commands.argument("entry", StringArgumentType.word())
                                .executes(
                                    context ->
                                        faq(
                                            context,
                                            LongArgumentType.getLong(context, "id"),
                                            StringArgumentType.getString(context, "entry"))))))
        .then(
            Commands.literal("case")
                .then(
                    Commands.argument("id", LongArgumentType.longArg(1))
                        .executes(
                            context -> showCase(context, LongArgumentType.getLong(context, "id")))))
        .build();
  }

  private LiteralCommandNode<CommandSourceStack> queue() {
    return Commands.literal("escalations")
        .requires(source -> source.getSender().hasPermission(AgentPermissions.STAFF))
        .executes(this::escalations)
        .build();
  }

  private int escalations(CommandContext<CommandSourceStack> context) {
    var sender = context.getSource().getSender();
    CompletableFuture<Queues> queues =
        log.escalations(LIMIT)
            .thenCompose(this::named)
            .thenCombine(log.samples(LIMIT).thenCompose(this::named), Queues::new);
    runtime.onMain(
        queues,
        "reading escalations",
        both -> {
          sendQueue(
              sender,
              "Open escalations on " + runtime.serverId() + " (overturn a row to dismiss it):",
              "No open escalations.",
              both.escalated());
          sendQueue(
              sender,
              "Spot-checks on " + runtime.serverId() + " (endorse or overturn a row to clear it):",
              "No sampled decisions to review.",
              both.sampled());
        },
        failure -> sender.sendMessage(Component.text("Couldn't read the decision log.")));
    return Command.SINGLE_SUCCESS;
  }

  private static void sendQueue(
      CommandSender sender, String heading, String empty, List<Named> rows) {
    if (rows.isEmpty()) {
      sender.sendMessage(Component.text(empty));
      return;
    }
    sender.sendMessage(Component.text(heading));
    for (var row : rows) {
      sender.sendMessage(Component.text(line(row)));
    }
  }

  private int decisions(CommandContext<CommandSourceStack> context, String playerName) {
    var sender = context.getSource().getSender();
    CompletableFuture<Optional<UUID>> target =
        playerName == null
            ? CompletableFuture.completedFuture(Optional.empty())
            : players.byName(playerName).thenApply(found -> found.map(KnownPlayer::uuid));
    CompletableFuture<Optional<List<Named>>> rows =
        target.thenCompose(
            uuid -> {
              if (playerName != null && uuid.isEmpty()) {
                return CompletableFuture.completedFuture(Optional.<List<Named>>empty());
              }
              CompletableFuture<List<AgentDecision>> found =
                  uuid.map(id -> log.recentBy(id, LIMIT)).orElseGet(() -> log.recent(LIMIT));
              return found.thenCompose(this::named).thenApply(Optional::of);
            });
    runtime.onMain(
        rows,
        "reading decisions",
        found ->
            found.ifPresentOrElse(
                listed -> send(sender, listed, playerName),
                () ->
                    sender.sendMessage(
                        Component.text("No player named " + playerName + " has joined."))),
        failure -> sender.sendMessage(Component.text("Couldn't read the decision log.")));
    return Command.SINGLE_SUCCESS;
  }

  private int sweepNow(CommandContext<CommandSourceStack> context) {
    var sender = context.getSource().getSender();
    runtime.onMain(
        flows.sweep().sweep(),
        "sweeping stale tickets",
        report -> {
          if (report.busy()) {
            sender.sendMessage(Component.text("A sweep is already running."));
            return;
          }
          sender.sendMessage(
              Component.text(
                  "Sweep: "
                      + report.redriven()
                      + " redriven, "
                      + report.slaBreached()
                      + " escalated, "
                      + report.failed()
                      + " failed."));
        },
        failure -> sender.sendMessage(Component.text("Couldn't sweep stale tickets.")));
    return Command.SINGLE_SUCCESS;
  }

  private int overturn(CommandContext<CommandSourceStack> context, long id) {
    var sender = context.getSource().getSender();
    if (!(sender instanceof Player player)) {
      sender.sendMessage(Component.text("Only players can overturn decisions."));
      return Command.SINGLE_SUCCESS;
    }
    runtime.onMain(
        flows
            .overturn()
            .overturn(id, player.getUniqueId(), player.getName())
            .thenCompose(this::describe),
        "overturning decision " + id,
        sender::sendMessage,
        failure -> sender.sendMessage(Component.text("Couldn't overturn that decision.")));
    return Command.SINGLE_SUCCESS;
  }

  private int endorse(CommandContext<CommandSourceStack> context, long id) {
    var sender = context.getSource().getSender();
    if (!(sender instanceof Player player)) {
      sender.sendMessage(Component.text("Only players can endorse decisions."));
      return Command.SINGLE_SUCCESS;
    }
    runtime.onMain(
        flows.endorse().endorse(id, player.getUniqueId()).thenCompose(this::describeEndorsement),
        "endorsing decision " + id,
        sender::sendMessage,
        failure -> sender.sendMessage(Component.text("Couldn't endorse that decision.")));
    return Command.SINGLE_SUCCESS;
  }

  private CompletableFuture<Component> describeEndorsement(EndorseFlow.Outcome outcome) {
    return switch (outcome) {
      case EndorseFlow.Outcome.Missing(var id) ->
          CompletableFuture.completedFuture(Component.text("No decision #" + id + "."));
      case EndorseFlow.Outcome.AlreadyOverturned(var decision, var by) ->
          players
              .byId(by)
              .thenApply(
                  found ->
                      Component.text(
                          "Decision #"
                              + decision.id()
                              + " was already overturned by "
                              + found.map(KnownPlayer::lastName).orElseGet(() -> shortId(by))
                              + "."));
      case EndorseFlow.Outcome.AlreadyEndorsed(var decision, var by) ->
          players
              .byId(by)
              .thenApply(
                  found ->
                      Component.text(
                          "Decision #"
                              + decision.id()
                              + " was already endorsed by "
                              + found.map(KnownPlayer::lastName).orElseGet(() -> shortId(by))
                              + "."));
      case EndorseFlow.Outcome.Endorsed(var decision) ->
          CompletableFuture.completedFuture(
              Component.text("Decision #" + decision.id() + " endorsed and cleared from review."));
    };
  }

  private int faq(CommandContext<CommandSourceStack> context, long id, @Nullable String entry) {
    var sender = context.getSource().getSender();
    runtime.onMain(
        flows.faq().answer(id, Optional.ofNullable(entry)),
        "answering ticket " + id,
        outcome -> sender.sendMessage(Component.text(describeFaq(outcome))),
        failure -> sender.sendMessage(Component.text("Couldn't answer that ticket.")));
    return Command.SINGLE_SUCCESS;
  }

  private static String describeFaq(FaqFlow.AnswerOutcome outcome) {
    return switch (outcome) {
      case FaqFlow.AnswerOutcome.Missing(var ticketId) -> "No ticket #" + ticketId + ".";
      case FaqFlow.AnswerOutcome.UnknownEntry(var entryId) -> "No FAQ entry " + entryId + ".";
      case FaqFlow.AnswerOutcome.NoMatch(var ticketId) ->
          "No FAQ entry matches ticket #" + ticketId + ".";
      case FaqFlow.AnswerOutcome.Answered(var ticketId, var entryId) ->
          "Answered ticket #" + ticketId + " with FAQ " + entryId + ".";
    };
  }

  private CompletableFuture<Component> describe(OverturnFlow.Outcome outcome) {
    return switch (outcome) {
      case OverturnFlow.Outcome.Missing(var id) ->
          CompletableFuture.completedFuture(Component.text("No decision #" + id + "."));
      case OverturnFlow.Outcome.AlreadyOverturned(var decision, var by) ->
          players
              .byId(by)
              .thenApply(
                  found ->
                      Component.text(
                          "Decision #"
                              + decision.id()
                              + " was already overturned by "
                              + found.map(KnownPlayer::lastName).orElseGet(() -> shortId(by))
                              + "."));
      case OverturnFlow.Outcome.Overturned(var decision, var lifted) ->
          CompletableFuture.completedFuture(Component.text(overturnedMessage(decision, lifted)));
    };
  }

  private static String overturnedMessage(AgentDecision decision, boolean lifted) {
    var base = "Decision #" + decision.id() + " ";
    return switch (decision.action()) {
      case ESCALATE -> base + "dismissed.";
      case MUTE ->
          lifted ? base + "overturned: mute lifted." : base + "overturned (already unmuted).";
      case WARN, KICK, TEMPBAN, ALLOW -> base + "overturned and logged as a correction.";
    };
  }

  private int showCase(CommandContext<CommandSourceStack> context, long id) {
    var sender = context.getSource().getSender();
    CompletableFuture<Optional<CasePayload>> assembled =
        flows
            .cases()
            .assemble(id)
            .thenCompose(
                found -> {
                  if (found.isEmpty()) {
                    return CompletableFuture.completedFuture(Optional.<CasePayload>empty());
                  }
                  var view = found.orElseThrow();
                  return players
                      .byId(view.ticket().reporter())
                      .thenApply(
                          reporter ->
                              Optional.of(
                                  new CasePayload(
                                      view, reporter.map(KnownPlayer::lastName).orElse("?"))));
                });
    runtime.onMain(
        assembled,
        "assembling case " + id,
        found ->
            found.ifPresentOrElse(
                payload -> sendCase(sender, payload.view(), payload.reporter()),
                () -> sender.sendMessage(Component.text("No ticket #" + id + "."))),
        failure -> sender.sendMessage(Component.text("Couldn't assemble that case.")));
    return Command.SINGLE_SUCCESS;
  }

  private static void sendCase(CommandSender sender, CaseFlow.CaseView view, String reporter) {
    var ticket = view.ticket();
    sender.sendMessage(
        Component.text(
            "Ticket #"
                + ticket.id()
                + " ["
                + ticket.categoryId()
                + "] "
                + ticket.statusId()
                + " ("
                + ticket.priorityId()
                + ") from "
                + reporter
                + ": "
                + ticket.summary()));
    ticket
        .triage()
        .ifPresent(
            triage ->
                sender.sendMessage(
                    Component.text("Triage [" + triage.priorityId() + "]: " + triage.evidence())));
    var standing = view.standing();
    var history =
        standing.history().isEmpty()
            ? "clean"
            : standing.history().stream()
                .map(entry -> entry.actionId() + " (" + entry.reason() + ")")
                .collect(Collectors.joining(", "));
    sender.sendMessage(
        Component.text(
            "Standing: "
                + (standing.banned() ? "BANNED" : "not banned")
                + "; history: "
                + history));
    if (view.trail().isEmpty()) {
      sender.sendMessage(Component.text("Agent trail: none yet."));
    } else {
      sender.sendMessage(Component.text("Agent trail:"));
      for (var row : view.trail()) {
        sender.sendMessage(Component.text("  " + trailLine(row)));
      }
    }
    if (!view.precedents().isEmpty()) {
      sender.sendMessage(
          Component.text(
              "Precedents: "
                  + view.precedents().stream()
                      .map(row -> row.action().id() + " " + row.offense().id())
                      .collect(Collectors.joining(", "))));
    }
  }

  private static String trailLine(AgentDecision row) {
    return "#"
        + row.id()
        + " "
        + row.classification()
        + " conf="
        + String.format(Locale.ROOT, "%.2f", row.confidence())
        + " "
        + row.model()
        + (row.shadow() ? " shadow" : "")
        + (row.overturnedBy().isPresent() ? " overturned" : "")
        + (row.endorsedBy().isPresent() ? " endorsed" : "")
        + " — "
        + row.note();
  }

  private CompletableFuture<List<Named>> named(List<AgentDecision> rows) {
    var lookups =
        rows.stream()
            .map(
                row ->
                    players
                        .byId(row.player())
                        .thenApply(
                            found ->
                                new Named(
                                    row,
                                    found
                                        .map(KnownPlayer::lastName)
                                        .orElseGet(() -> shortId(row.player())))))
            .toList();
    return CompletableFuture.allOf(lookups.toArray(CompletableFuture[]::new))
        .thenApply(done -> lookups.stream().map(CompletableFuture::join).toList());
  }

  private void send(CommandSender sender, List<Named> rows, String playerName) {
    if (rows.isEmpty()) {
      sender.sendMessage(Component.text("No agent decisions yet."));
      return;
    }
    sender.sendMessage(
        Component.text(
            playerName == null
                ? "Latest agent decisions on " + runtime.serverId() + " (shadow = watched only):"
                : "Latest agent decisions for "
                    + playerName
                    + " on "
                    + runtime.serverId()
                    + " (shadow = watched only):"));
    for (var row : rows) {
      sender.sendMessage(Component.text(line(row)));
    }
  }

  private static String line(Named row) {
    var decision = row.decision();
    var line =
        "#"
            + decision.id()
            + " "
            + row.name()
            + " "
            + decision.offense().id()
            + " "
            + decision.action().id()
            + (decision.shadow() ? " shadow" : "")
            + " conf="
            + String.format(Locale.ROOT, "%.2f", decision.confidence())
            + " "
            + decision.model();
    if (decision.ladderStep().isPresent()) {
      line += " rung=" + decision.ladderStep().orElseThrow();
    }
    if (decision.ticketId().isPresent()) {
      line += " ticket #" + decision.ticketId().orElseThrow();
    }
    if (decision.overturnedBy().isPresent()) {
      line += " overturned";
    }
    if (decision.endorsedBy().isPresent()) {
      line += " endorsed";
    }
    if (decision.sampled()) {
      line += " sampled";
    }
    var note = decision.note();
    if (note.length() > NOTE_LENGTH) {
      note = note.substring(0, NOTE_LENGTH) + "...";
    }
    return line + " — " + note;
  }

  private static String shortId(UUID id) {
    return id.toString().substring(0, 8);
  }

  private record Named(AgentDecision decision, String name) {}
}
