package com.shepherdjerred.thestorm.creative.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.context.CommandContext;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.creative.app.ClaimBook;
import com.shepherdjerred.thestorm.creative.app.ReviewBook;
import com.shepherdjerred.thestorm.creative.app.ReviewBook.Comment;
import com.shepherdjerred.thestorm.creative.app.ReviewStore;
import com.shepherdjerred.thestorm.creative.domain.CreativeConfig;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.PlotReviews;
import com.shepherdjerred.thestorm.creative.domain.PlotRole;
import com.shepherdjerred.thestorm.creative.domain.PlotView;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Predicate;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/** One rating per player and short public comments. Both show on {@code /creative info}. */
final class CreativeReviewCommands {

  private static final String LABEL = "Creative";
  private static final int LATEST = 3;

  record Hooks(
      ModuleContext context,
      CreativeConfig config,
      ClaimBook book,
      ReviewBook reviews,
      ReviewStore store,
      Predicate<Player> ready,
      Function<Player, Optional<PlotId>> standing,
      Function<PlotId, PlotView> view,
      Function<PlotId, StoredClaim> claimHere) {}

  private final Hooks hooks;

  CreativeReviewCommands(Hooks hooks) {
    this.hooks = hooks;
  }

  List<String> lines(PlotId id) {
    if (!hooks.reviews().ready()) {
      return List.of();
    }
    var lines = new ArrayList<String>();
    var scores = hooks.reviews().ratings(id);
    if (scores.isEmpty()) {
      lines.add("No ratings.");
    } else {
      var players = scores.size() == 1 ? "player" : "players";
      lines.add(
          "Rating " + PlotReviews.average(scores) + " from " + scores.size() + " " + players + ".");
    }
    var notes = hooks.reviews().comments(id);
    int start = Math.max(0, notes.size() - LATEST);
    for (int i = start; i < notes.size(); i++) {
      var note = notes.get(i);
      lines.add(note.author() + ": " + note.body());
    }
    return List.copyOf(lines);
  }

  int rate(CommandContext<CommandSourceStack> context) {
    var standing = plot(context);
    if (standing.isEmpty()) {
      return Command.SINGLE_SUCCESS;
    }
    var here = standing.orElseThrow();
    var score = score(here.player(), getString(context, "score"));
    if (score.isEmpty()) {
      return Command.SINGLE_SUCCESS;
    }
    var value = score.orElseThrow();
    var current = hooks.reviews().ratings(here.id()).get(here.player().getUniqueId());
    if (current != null && current.intValue() == value) {
      error(here.player(), "You already rated " + here.id().text() + " as " + value + ".");
      return Command.SINGLE_SUCCESS;
    }
    var previous = Optional.ofNullable(current);
    var ensured = ensure(here.id());
    hooks.reviews().putRating(here.id(), here.player().getUniqueId(), value);
    var attempt = new RatingSave(here.player(), here.id(), value, previous, ensured);
    var saved =
        hooks
            .store()
            .rate(ensured, here.id(), here.player().getUniqueId(), value)
            .whenCompleteAsync(
                (ignored, failure) -> rated(attempt, failure),
                hooks.context().scheduler().mainThread());
    var _ = saved;
    return Command.SINGLE_SUCCESS;
  }

  int comment(CommandContext<CommandSourceStack> context) {
    var standing = plot(context);
    if (standing.isEmpty()) {
      return Command.SINGLE_SUCCESS;
    }
    var here = standing.orElseThrow();
    var text = getString(context, "text").strip();
    if (!PlotReviews.fits(text, hooks.config().commentLength())) {
      error(
          here.player(), "Use a comment up to " + hooks.config().commentLength() + " characters.");
      return Command.SINGLE_SUCCESS;
    }
    if (hooks.reviews().comments(here.id()).size() >= hooks.config().commentCap()) {
      error(here.player(), "This plot has too many comments.");
      return Command.SINGLE_SUCCESS;
    }
    var note =
        new Comment(
            here.id(),
            here.player().getUniqueId(),
            here.player().getName(),
            text,
            nextPosted(here.id()));
    var ensured = ensure(here.id());
    hooks.reviews().addComment(note);
    var saved =
        hooks
            .store()
            .comment(ensured, note)
            .whenCompleteAsync(
                (ignored, failure) -> commented(here.player(), note, ensured, failure),
                hooks.context().scheduler().mainThread());
    var _ = saved;
    return Command.SINGLE_SUCCESS;
  }

  int delete(CommandContext<CommandSourceStack> context) {
    var standing = plot(context);
    if (standing.isEmpty()) {
      return Command.SINGLE_SUCCESS;
    }
    var here = standing.orElseThrow();
    var note = chosen(here);
    if (note.isEmpty()) {
      error(here.player(), "You have no comment to delete.");
      return Command.SINGLE_SUCCESS;
    }
    var target = note.orElseThrow();
    hooks.reviews().removeComment(target.plot(), target.player(), target.posted());
    var saved =
        hooks
            .store()
            .delete(target.plot(), target.player(), target.posted())
            .whenCompleteAsync(
                (ignored, failure) -> deleted(here.player(), target, owns(here), failure),
                hooks.context().scheduler().mainThread());
    var _ = saved;
    return Command.SINGLE_SUCCESS;
  }

  private Optional<Comment> chosen(Here here) {
    var notes = hooks.reviews().comments(here.id());
    if (notes.isEmpty()) {
      return Optional.empty();
    }
    if (owns(here)) {
      return Optional.of(notes.getLast());
    }
    Comment own = null;
    for (var note : notes) {
      if (note.player().equals(here.player().getUniqueId())) {
        own = note;
      }
    }
    return Optional.ofNullable(own);
  }

  private int nextPosted(PlotId id) {
    var posted = 0;
    for (var note : hooks.reviews().comments(id)) {
      posted = Math.max(posted, note.posted());
    }
    return posted + 1;
  }

  private Optional<StoredClaim> ensure(PlotId id) {
    if (hooks.book().row(id).isPresent()) {
      return Optional.empty();
    }
    var created = hooks.claimHere().apply(id);
    hooks.book().put(created);
    return Optional.of(created);
  }

  private void rated(RatingSave attempt, @Nullable Throwable failure) {
    var player = attempt.player();
    if (failure != null) {
      restoreRating(attempt.id(), player.getUniqueId(), attempt.previous());
      dropEnsured(attempt.ensured());
      hooks.context().logger().error("Creative rating failed for {}", attempt.id().text(), failure);
      if (player.isOnline()) {
        error(player, "That could not be saved.");
      }
      return;
    }
    if (player.isOnline()) {
      success(player, "Rated " + attempt.id().text() + " as " + attempt.score() + ".");
    }
  }

  /** One rating write and the book value to restore if it fails. */
  private record RatingSave(
      Player player,
      PlotId id,
      int score,
      Optional<Integer> previous,
      Optional<StoredClaim> ensured) {}

  private void dropEnsured(Optional<StoredClaim> ensured) {
    if (ensured.isPresent()) {
      hooks.book().remove(ensured.orElseThrow().id());
    }
  }

  private Optional<Integer> score(Player player, String text) {
    if (text.length() != 1 || text.charAt(0) < '1' || text.charAt(0) > '5') {
      error(player, "Use a rating from 1 to 5.");
      return Optional.empty();
    }
    return Optional.of(text.charAt(0) - '0');
  }

  private void restoreRating(PlotId id, UUID player, Optional<Integer> previous) {
    if (previous.isPresent()) {
      hooks.reviews().putRating(id, player, previous.orElseThrow());
    } else {
      hooks.reviews().removeRating(id, player);
    }
  }

  private void commented(
      Player player, Comment note, Optional<StoredClaim> ensured, @Nullable Throwable failure) {
    if (failure != null) {
      hooks.reviews().removeComment(note.plot(), note.player(), note.posted());
      dropEnsured(ensured);
      hooks.context().logger().error("Creative comment failed for {}", note.plot().text(), failure);
      if (player.isOnline()) {
        error(player, "That could not be saved.");
      }
      return;
    }
    if (player.isOnline()) {
      success(player, "Comment saved on " + note.plot().text() + ".");
    }
  }

  private void deleted(Player player, Comment note, boolean owner, @Nullable Throwable failure) {
    if (failure != null) {
      hooks.reviews().addComment(note);
      hooks
          .context()
          .logger()
          .error("Creative comment delete failed for {}", note.plot().text(), failure);
      if (player.isOnline()) {
        error(player, "That could not be saved.");
      }
      return;
    }
    if (!player.isOnline()) {
      return;
    }
    if (owner) {
      success(player, "Deleted the latest comment on " + note.plot().text() + ".");
    } else {
      success(player, "Deleted your comment on " + note.plot().text() + ".");
    }
  }

  private Optional<Here> plot(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (!hooks.ready().test(player)) {
      return Optional.empty();
    }
    if (!hooks.reviews().ready()) {
      error(player, "Creative claims are still loading.");
      return Optional.empty();
    }
    var at = hooks.standing().apply(player);
    if (at.isEmpty()) {
      error(player, "You are standing on a road.");
      return Optional.empty();
    }
    var id = at.orElseThrow();
    var view = hooks.view().apply(id);
    if (!view.marked()) {
      error(player, "That plot is not claimed.");
      return Optional.empty();
    }
    if (!PlotRole.mayEnter(staff(player), view.access(), player.getUniqueId())) {
      error(player, "You cannot visit that plot.");
      return Optional.empty();
    }
    return Optional.of(new Here(player, id, view));
  }

  private static boolean owns(Here here) {
    return here.view().owner().isPresent()
        && here.view().owner().orElseThrow().equals(here.player().getUniqueId());
  }

  private static boolean staff(Player player) {
    return player.hasPermission(
            com.shepherdjerred.thestorm.creative.domain.CreativePermissions.BYPASS)
        || player.hasPermission(
            com.shepherdjerred.thestorm.creative.domain.CreativePermissions.ADMIN);
  }

  private record Here(Player player, PlotId id, PlotView view) {}

  private static Player player(CommandContext<CommandSourceStack> context) {
    return (Player) context.getSource().getSender();
  }

  private static void success(Player player, String text) {
    player.sendMessage(HouseStyle.success(LABEL, Component.text(text)));
  }

  private static void error(Player player, String text) {
    player.sendMessage(HouseStyle.error(LABEL, Component.text(text)));
  }
}
