package com.shepherdjerred.thestorm.creative.app;

import com.shepherdjerred.thestorm.creative.domain.PlotId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Ratings and comments for protection-free reads on the main thread. A store callback replaces the
 * snapshot there. Until {@link #replace} runs, {@link #ready} is false.
 */
public final class ReviewBook {

  /** One player's score for one plot. */
  public record Rating(PlotId plot, UUID player, int score) {}

  /** One public comment. {@code posted} orders comments on that plot. */
  public record Comment(PlotId plot, UUID player, String author, String body, int posted) {}

  private volatile Map<PlotId, Map<UUID, Integer>> ratings = Map.of();
  private volatile Map<PlotId, List<Comment>> comments = Map.of();
  private volatile boolean ready;

  public boolean ready() {
    return ready;
  }

  public void replace(List<Rating> scores, List<Comment> notes) {
    var nextScores = new HashMap<PlotId, Map<UUID, Integer>>();
    for (var score : scores) {
      var plot = nextScores.computeIfAbsent(score.plot(), ignored -> new HashMap<>());
      plot.put(score.player(), score.score());
    }
    var frozen = new HashMap<PlotId, Map<UUID, Integer>>();
    for (var entry : nextScores.entrySet()) {
      frozen.put(entry.getKey(), Map.copyOf(entry.getValue()));
    }
    var nextNotes = new HashMap<PlotId, List<Comment>>();
    for (var note : notes) {
      nextNotes.computeIfAbsent(note.plot(), ignored -> new ArrayList<>()).add(note);
    }
    var ordered = new HashMap<PlotId, List<Comment>>();
    for (var entry : nextNotes.entrySet()) {
      var list = entry.getValue();
      list.sort(Comparator.comparingInt(Comment::posted));
      ordered.put(entry.getKey(), List.copyOf(list));
    }
    ratings = Map.copyOf(frozen);
    comments = Map.copyOf(ordered);
    ready = true;
  }

  public Map<UUID, Integer> ratings(PlotId id) {
    return ratings.getOrDefault(id, Map.of());
  }

  public List<Comment> comments(PlotId id) {
    return comments.getOrDefault(id, List.of());
  }

  public void putRating(PlotId id, UUID player, int score) {
    var next = new HashMap<>(ratings);
    var plot = new HashMap<>(next.getOrDefault(id, Map.of()));
    plot.put(player, score);
    next.put(id, Map.copyOf(plot));
    ratings = Map.copyOf(next);
  }

  public void removeRating(PlotId id, UUID player) {
    var next = new HashMap<>(ratings);
    var plot = new HashMap<>(next.getOrDefault(id, Map.of()));
    plot.remove(player);
    if (plot.isEmpty()) {
      next.remove(id);
    } else {
      next.put(id, Map.copyOf(plot));
    }
    ratings = Map.copyOf(next);
  }

  public void addComment(Comment comment) {
    var next = new HashMap<>(comments);
    var plot = new ArrayList<>(next.getOrDefault(comment.plot(), List.of()));
    plot.add(comment);
    plot.sort(Comparator.comparingInt(Comment::posted));
    next.put(comment.plot(), List.copyOf(plot));
    comments = Map.copyOf(next);
  }

  public void removeComment(PlotId id, UUID player, int posted) {
    var next = new HashMap<>(comments);
    var plot = new ArrayList<Comment>();
    for (var comment : next.getOrDefault(id, List.of())) {
      if (comment.player().equals(player) && comment.posted() == posted) {
        continue;
      }
      plot.add(comment);
    }
    if (plot.isEmpty()) {
      next.remove(id);
    } else {
      next.put(id, List.copyOf(plot));
    }
    comments = Map.copyOf(next);
  }
}
