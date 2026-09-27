package com.shepherdjerred.thestorm.tickets.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.suggestion.Suggestions;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.core.players.KnownPlayer;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tickets.app.TicketConfig;
import com.shepherdjerred.thestorm.tickets.app.TicketService;
import com.shepherdjerred.thestorm.tickets.domain.CommentDraft;
import com.shepherdjerred.thestorm.tickets.domain.Ticket;
import com.shepherdjerred.thestorm.tickets.domain.TicketCategory;
import com.shepherdjerred.thestorm.tickets.domain.TicketComment;
import com.shepherdjerred.thestorm.tickets.domain.TicketDraft;
import com.shepherdjerred.thestorm.tickets.domain.TicketError;
import com.shepherdjerred.thestorm.tickets.domain.TicketFilter;
import com.shepherdjerred.thestorm.tickets.domain.TicketLocation;
import com.shepherdjerred.thestorm.tickets.domain.TicketPriority;
import com.shepherdjerred.thestorm.tickets.domain.TicketRequest;
import com.shepherdjerred.thestorm.tickets.domain.TicketStatus;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.JoinConfiguration;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * {@code /ticket} (file, view, claim, comment, note, resolve, escalate, reopen) and {@code
 * /tickets} (queues). Filing and tracking own tickets is open to every player; handling the queue
 * needs {@code thestorm.tickets.staff}. Anything recording a human author needs a player behind it;
 * the console can list, view, resolve, escalate, and reopen.
 */
public final class TicketCommands {

  private static final String TEXT = "text";
  private static final String FILTER = "filter";

  private final TicketService tickets;
  private final PlayerDirectory players;
  private final TicketConfig config;
  private final TicketRuntime runtime;

  public TicketCommands(
      TicketService tickets, PlayerDirectory players, TicketConfig config, TicketRuntime runtime) {
    this.tickets = tickets;
    this.players = players;
    this.config = config;
    this.runtime = runtime;
  }

  /** Registers {@code /ticket} and {@code /tickets}. */
  public void register(Commands commands) {
    commands.register(ticket(), "File and work player report tickets");
    commands.register(tickets(), "List report tickets");
  }

  private LiteralCommandNode<CommandSourceStack> ticket() {
    return Commands.literal("ticket")
        .executes(this::usage)
        .then(
            Commands.argument(TEXT, StringArgumentType.greedyString())
                .suggests(this::suggestActions)
                .executes(this::run))
        .build();
  }

  private LiteralCommandNode<CommandSourceStack> tickets() {
    return Commands.literal("tickets")
        .executes(context -> list(context.getSource().getSender(), "open"))
        .then(
            Commands.argument(FILTER, StringArgumentType.word())
                .suggests(this::suggestFilters)
                .executes(
                    context ->
                        list(
                            context.getSource().getSender(),
                            StringArgumentType.getString(context, FILTER))))
        .build();
  }

  private int usage(CommandContext<CommandSourceStack> context) {
    var sender = context.getSource().getSender();
    sender.sendMessage(
        Feedback.info("/ticket <what happened> — or view, claim, comment, resolve, escalate."));
    return Command.SINGLE_SUCCESS;
  }

  private int run(CommandContext<CommandSourceStack> context) {
    var sender = context.getSource().getSender();
    switch (TicketRequest.parse(StringArgumentType.getString(context, TEXT))) {
      case Result.Ok<TicketRequest, String>(var request) -> execute(sender, request);
      case Result.Err<TicketRequest, String>(var problem) ->
          sender.sendMessage(Feedback.error(problem));
    }
    return Command.SINGLE_SUCCESS;
  }

  private void execute(CommandSender sender, TicketRequest request) {
    switch (request) {
      case TicketRequest.File(var category, var summary) -> file(sender, category, summary);
      case TicketRequest.View(var id) -> view(sender, id);
      case TicketRequest.Claim(var id) -> claim(sender, id);
      case TicketRequest.Comment(var id, var text) -> comment(sender, id, text, false);
      case TicketRequest.Note(var id, var text) -> comment(sender, id, text, true);
      case TicketRequest.Resolve(var id, var note) -> resolve(sender, id, note);
      case TicketRequest.Escalate(var id) ->
          transition(sender, id, TicketStatus.ESCALATED, "escalated for human review");
      case TicketRequest.Reopen(var id) -> transition(sender, id, TicketStatus.OPEN, "reopened");
    }
  }

  private void file(CommandSender sender, TicketCategory category, String summary) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(Feedback.error("Only players can file tickets."));
      return;
    }
    var place = player.getLocation();
    Optional<TicketLocation> location =
        place == null
            ? Optional.empty()
            : Optional.of(
                new TicketLocation(
                    player.getWorld().getName(),
                    place.getBlockX(),
                    place.getBlockY(),
                    place.getBlockZ()));
    var draft = new TicketDraft(player.getUniqueId(), category, summary, location);
    var staffOnline = runtime.server().getOnlinePlayers().stream().anyMatch(this::isStaff);
    runtime.onMain(
        tickets.open(draft),
        "filing a ticket",
        ticket -> {
          sender.sendMessage(
              Feedback.success(
                  "Ticket #"
                      + ticket.id()
                      + " opened — staff will review. Anything to add? /ticket comment "
                      + ticket.id()
                      + " <text>"));
          if (!staffOnline) {
            sender.sendMessage(
                Feedback.info(
                    "No staff are online right now — this is logged and staff will be"
                        + " notified."));
          }
        },
        failure -> sender.sendMessage(Feedback.error("Filing failed; staff have been told.")));
  }

  private void view(CommandSender sender, long id) {
    runtime.onMain(
        tickets.get(id),
        "reading ticket " + id,
        found -> {
          if (found.isEmpty()) {
            sender.sendMessage(Feedback.error(Feedback.describe(TicketError.TICKET_NOT_FOUND)));
            return;
          }
          var ticket = found.orElseThrow();
          if (!canSee(sender, ticket)) {
            sender.sendMessage(Feedback.error("That ticket isn't yours."));
            return;
          }
          showWithComments(sender, ticket);
        },
        failure -> sender.sendMessage(Feedback.error("Reading failed; staff have been told.")));
  }

  private void showWithComments(CommandSender sender, Ticket ticket) {
    runtime.onMain(
        tickets.comments(ticket.id()),
        "reading ticket " + ticket.id() + " comments",
        comments -> {
          var ids = new HashSet<UUID>();
          ids.add(ticket.reporter());
          ticket.claimer().ifPresent(ids::add);
          comments.forEach(comment -> ids.add(comment.author()));
          runtime.onMain(
              names(ids),
              "naming ticket " + ticket.id() + " players",
              resolved ->
                  sender.sendMessage(
                      TicketViews.detail(ticket, comments, resolved, isStaff(sender))),
              failure ->
                  sender.sendMessage(Feedback.error("Reading failed; staff have been told.")));
        },
        failure -> sender.sendMessage(Feedback.error("Reading failed; staff have been told.")));
  }

  private void claim(CommandSender sender, long id) {
    var staff = player(sender);
    if (staff.isEmpty() || !isStaff(sender)) {
      sender.sendMessage(Feedback.error("Only staff can do that."));
      return;
    }
    runtime.onMain(
        tickets.claim(id, staff.orElseThrow()),
        "claiming ticket " + id,
        result ->
            sender.sendMessage(
                switch (result) {
                  case Result.Ok<Ticket, TicketError>(var ticket) ->
                      Feedback.success("Ticket #" + ticket.id() + " claimed.");
                  case Result.Err<Ticket, TicketError>(var error) ->
                      Feedback.error(Feedback.describe(error));
                }),
        failure -> sender.sendMessage(Feedback.error("Claiming failed; staff have been told.")));
  }

  private void comment(CommandSender sender, long id, String text, boolean staffOnly) {
    var author = player(sender);
    if (author.isEmpty()) {
      sender.sendMessage(Feedback.error("Only players can comment on tickets."));
      return;
    }
    if (staffOnly && !isStaff(sender)) {
      sender.sendMessage(Feedback.error("Only staff can do that."));
      return;
    }
    runtime.onMain(
        tickets.get(id),
        "reading ticket " + id,
        found -> {
          if (found.isEmpty()) {
            sender.sendMessage(Feedback.error(Feedback.describe(TicketError.TICKET_NOT_FOUND)));
            return;
          }
          if (!canSee(sender, found.orElseThrow())) {
            sender.sendMessage(Feedback.error("That ticket isn't yours."));
            return;
          }
          runtime.onMain(
              tickets.comment(id, new CommentDraft(author.orElseThrow(), staffOnly, text)),
              "commenting on ticket " + id,
              result ->
                  sender.sendMessage(
                      switch (result) {
                        case Result.Ok<TicketComment, TicketError>(_) ->
                            Feedback.success("Noted on ticket #" + id + ".");
                        case Result.Err<TicketComment, TicketError>(var error) ->
                            Feedback.error(Feedback.describe(error));
                      }),
              failure ->
                  sender.sendMessage(Feedback.error("Commenting failed; staff have been told.")));
        },
        failure -> sender.sendMessage(Feedback.error("Reading failed; staff have been told.")));
  }

  private void resolve(CommandSender sender, long id, String note) {
    if (!isStaff(sender)) {
      sender.sendMessage(Feedback.error("Only staff can do that."));
      return;
    }
    CompletableFuture<Result<Ticket, TicketError>> moved;
    var author = player(sender);
    if (note.isEmpty() || author.isEmpty()) {
      moved = tickets.transition(id, TicketStatus.RESOLVED);
    } else {
      moved =
          tickets
              .comment(id, new CommentDraft(author.orElseThrow(), false, note))
              .thenCompose(
                  commented ->
                      switch (commented) {
                        case Result.Ok<TicketComment, TicketError>(_) ->
                            tickets.transition(id, TicketStatus.RESOLVED);
                        case Result.Err<TicketComment, TicketError>(var error) ->
                            CompletableFuture.completedFuture(Result.err(error));
                      });
    }
    runtime.onMain(
        moved,
        "resolving ticket " + id,
        result ->
            sender.sendMessage(
                switch (result) {
                  case Result.Ok<Ticket, TicketError>(var ticket) -> {
                    tellReporter(ticket, "Your ticket #" + ticket.id() + " was resolved.");
                    yield Feedback.success("Ticket #" + ticket.id() + " resolved.");
                  }
                  case Result.Err<Ticket, TicketError>(var error) ->
                      Feedback.error(Feedback.describe(error));
                }),
        failure -> sender.sendMessage(Feedback.error("Resolving failed; staff have been told.")));
  }

  private void transition(CommandSender sender, long id, TicketStatus next, String verb) {
    if (!isStaff(sender)) {
      sender.sendMessage(Feedback.error("Only staff can do that."));
      return;
    }
    runtime.onMain(
        tickets.transition(id, next),
        "moving ticket " + id,
        result ->
            sender.sendMessage(
                switch (result) {
                  case Result.Ok<Ticket, TicketError>(var ticket) ->
                      Feedback.success("Ticket #" + ticket.id() + " " + verb + ".");
                  case Result.Err<Ticket, TicketError>(var error) ->
                      Feedback.error(Feedback.describe(error));
                }),
        failure -> sender.sendMessage(Feedback.error("That failed; staff have been told.")));
  }

  private int list(CommandSender sender, String filterWord) {
    var filter = filterFor(sender, filterWord);
    if (filter.isEmpty()) {
      sender.sendMessage(Feedback.error("Queue must be open, mine, unclaimed, urgent, or all."));
      return Command.SINGLE_SUCCESS;
    }
    runtime.onMain(
        tickets.list(filter.orElseThrow()),
        "listing tickets",
        found -> {
          var page = found.stream().limit(config.pageSize()).toList();
          if (page.isEmpty()) {
            sender.sendMessage(Feedback.info("No tickets here."));
            return;
          }
          var ids = new HashSet<UUID>();
          page.forEach(ticket -> ids.add(ticket.reporter()));
          runtime.onMain(
              names(ids),
              "naming ticket reporters",
              resolved -> {
                var lines = new ArrayList<Component>();
                page.forEach(ticket -> lines.add(TicketViews.queueLine(ticket, resolved)));
                sender.sendMessage(Component.join(JoinConfiguration.newlines(), lines));
              },
              failure ->
                  sender.sendMessage(Feedback.error("Listing failed; staff have been told.")));
        },
        failure -> sender.sendMessage(Feedback.error("Listing failed; staff have been told.")));
    return Command.SINGLE_SUCCESS;
  }

  private Optional<TicketFilter> filterFor(CommandSender sender, String filterWord) {
    var self = player(sender);
    if (!isStaff(sender)) {
      return self.map(TicketFilter::filedBy);
    }
    return switch (filterWord.toLowerCase(Locale.ROOT)) {
      case "open" -> Optional.of(TicketFilter.open());
      case "mine" -> self.map(TicketFilter::claimedBy);
      case "unclaimed" -> Optional.of(TicketFilter.unclaimed());
      case "urgent" -> Optional.of(TicketFilter.urgent(TicketPriority.NORMAL));
      case "all" -> Optional.of(TicketFilter.all());
      default -> Optional.empty();
    };
  }

  private CompletableFuture<Function<UUID, String>> names(Set<UUID> ids) {
    Map<UUID, CompletableFuture<String>> lookups = new HashMap<>();
    for (var id : ids) {
      lookups.put(
          id,
          players
              .byId(id)
              .thenApply(found -> found.map(KnownPlayer::lastName).orElseGet(() -> shortId(id))));
    }
    return CompletableFuture.allOf(lookups.values().toArray(CompletableFuture[]::new))
        .thenApply(
            done -> {
              Map<UUID, String> resolved = new HashMap<>();
              lookups.forEach((id, lookup) -> resolved.put(id, lookup.join()));
              return (Function<UUID, String>) id -> resolved.getOrDefault(id, shortId(id));
            });
  }

  private void tellReporter(Ticket ticket, String message) {
    var reporter = runtime.server().getPlayer(ticket.reporter());
    if (reporter != null) {
      reporter.sendMessage(Feedback.success(message));
    }
  }

  private boolean canSee(CommandSender sender, Ticket ticket) {
    if (isStaff(sender)) {
      return true;
    }
    return player(sender).map(ticket.reporter()::equals).orElse(false);
  }

  private boolean isStaff(CommandSender sender) {
    return sender.hasPermission(TicketPermissions.STAFF);
  }

  private Optional<UUID> player(CommandSender sender) {
    if (sender instanceof Player player) {
      return Optional.of(player.getUniqueId());
    }
    return Optional.empty();
  }

  private static String shortId(UUID id) {
    return id.toString().substring(0, 8);
  }

  private CompletableFuture<Suggestions> suggestActions(
      CommandContext<CommandSourceStack> context, SuggestionsBuilder builder) {
    var staff = isStaff(context.getSource().getSender());
    List<String> words = new ArrayList<>(List.of("view", "comment"));
    if (staff) {
      words.addAll(List.of("claim", "resolve", "escalate", "reopen", "note"));
    } else {
      words.add("grief");
      words.add("theft");
      words.add("cheat");
      words.add("chat");
      words.add("appeal");
    }
    var remaining = builder.getRemainingLowerCase();
    words.stream().filter(word -> word.startsWith(remaining)).forEach(builder::suggest);
    return builder.buildFuture();
  }

  private CompletableFuture<Suggestions> suggestFilters(
      CommandContext<CommandSourceStack> context, SuggestionsBuilder builder) {
    List<String> words;
    if (isStaff(context.getSource().getSender())) {
      words = List.of("open", "mine", "unclaimed", "urgent", "all");
    } else {
      words = List.of("mine");
    }
    var remaining = builder.getRemainingLowerCase();
    words.stream().filter(word -> word.startsWith(remaining)).forEach(builder::suggest);
    return builder.buildFuture();
  }
}
