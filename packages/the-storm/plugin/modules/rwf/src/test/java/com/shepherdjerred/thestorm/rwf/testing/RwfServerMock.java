package com.shepherdjerred.thestorm.rwf.testing;

import io.papermc.paper.scoreboard.numbers.NumberFormat;
import java.lang.reflect.Field;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import net.kyori.adventure.text.Component;
import org.bukkit.scoreboard.Criteria;
import org.bukkit.scoreboard.DisplaySlot;
import org.bukkit.scoreboard.Objective;
import org.bukkit.scoreboard.RenderType;
import org.bukkit.scoreboard.Score;
import org.jspecify.annotations.Nullable;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.scoreboard.ObjectiveMock;
import org.mockbukkit.mockbukkit.scoreboard.ScoreMock;
import org.mockbukkit.mockbukkit.scoreboard.ScoreboardManagerMock;
import org.mockbukkit.mockbukkit.scoreboard.ScoreboardMock;

/** Paper number formats with complete objective registration, score and display-slot lifecycles. */
public final class RwfServerMock {
  private static final Field SCOREBOARDS = scoreboardField();

  private RwfServerMock() {}

  /** Installs the missing Paper fixture API on an ordinary ServerMock without subclassing it. */
  public static ServerMock create() {
    var server = new ServerMock();
    try {
      SCOREBOARDS.set(server, new Manager());
    } catch (IllegalAccessException failure) {
      throw new IllegalStateException(
          "Pinned MockBukkit scoreboard manager cannot be installed", failure);
    }
    return server;
  }

  private static Field scoreboardField() {
    try {
      var field = ServerMock.class.getDeclaredField("scoreboardManager");
      if (field.getType() != ScoreboardManagerMock.class) {
        throw new IllegalStateException("Pinned MockBukkit scoreboard manager type changed");
      }
      field.setAccessible(true);
      return field;
    } catch (NoSuchFieldException failure) {
      throw new IllegalStateException(
          "Pinned MockBukkit scoreboard manager field is missing", failure);
    }
  }

  private static final class Manager extends ScoreboardManagerMock {
    private final ScoreboardMock main = new Board();

    @Override
    public ScoreboardMock getMainScoreboard() {
      return main;
    }

    @Override
    public ScoreboardMock getNewScoreboard() {
      return new Board();
    }
  }

  private record Definition(
      String name, Criteria criteria, @Nullable Component title, RenderType render) {}

  private static final class FormattedObjective extends ObjectiveMock {
    private @Nullable NumberFormat format;
    private final Map<String, ScoreMock> accessed = new HashMap<>();

    FormattedObjective(Board board, Definition definition) {
      super(
          board, definition.name(), definition.title(), definition.criteria(), definition.render());
    }

    @Override
    public @Nullable NumberFormat numberFormat() {
      getName();
      return format;
    }

    @Override
    public void numberFormat(@Nullable NumberFormat next) {
      getName();
      format = next;
    }

    @Override
    public ScoreMock getScore(String entry) {
      var score = super.getScore(entry);
      accessed.put(entry, score);
      return score;
    }

    Set<String> entries() {
      return accessed.entrySet().stream()
          .filter(entry -> entry.getValue().isScoreSet())
          .map(Map.Entry::getKey)
          .collect(Collectors.toUnmodifiableSet());
    }
  }

  private static final class Board extends ScoreboardMock {
    private final Map<String, FormattedObjective> objectives = new HashMap<>();
    private final Map<DisplaySlot, ObjectiveMock> slots = new EnumMap<>(DisplaySlot.class);

    @Override
    public ObjectiveMock registerNewObjective(
        String name, Criteria criteria, @Nullable Component title, RenderType render) {
      Objects.requireNonNull(name);
      Objects.requireNonNull(criteria);
      Objects.requireNonNull(render);
      if (name.length() > 32767 || objectives.containsKey(name)) {
        throw new IllegalArgumentException("invalid or duplicate objective: " + name);
      }
      var objective = new FormattedObjective(this, new Definition(name, criteria, title, render));
      objectives.put(name, objective);
      return objective;
    }

    @Override
    public @Nullable ObjectiveMock getObjective(String name) {
      return objectives.get(name);
    }

    @Override
    public @Nullable ObjectiveMock getObjective(DisplaySlot slot) {
      return slots.get(slot);
    }

    @Override
    public Set<Objective> getObjectives() {
      return Set.copyOf(objectives.values());
    }

    @Override
    public Set<Objective> getObjectivesByCriteria(Criteria criteria) {
      return getObjectives().stream()
          .filter(objective -> objective.getTrackedCriteria().equals(criteria))
          .collect(Collectors.toUnmodifiableSet());
    }

    @Override
    public Set<Objective> getObjectivesByCriteria(String criteria) {
      return getObjectives().stream()
          .filter(objective -> objective.getTrackedCriteria().getName().equals(criteria))
          .collect(Collectors.toUnmodifiableSet());
    }

    @Override
    public Set<Score> getScores(String entry) {
      return objectives.values().stream()
          .map(objective -> (Score) objective.getScore(entry))
          .collect(Collectors.toUnmodifiableSet());
    }

    @Override
    public void resetScores(String entry) {
      objectives.values().forEach(objective -> objective.getScore(entry).resetScore());
    }

    @Override
    public Set<String> getEntries() {
      var entries = new HashSet<>(super.getEntries());
      objectives.values().forEach(objective -> entries.addAll(objective.entries()));
      return Set.copyOf(entries);
    }

    @Override
    public void clearSlot(DisplaySlot slot) {
      var objective = slots.get(slot);
      if (objective != null) objective.setDisplaySlot(null);
    }

    @Override
    protected void setDisplaySlot(ObjectiveMock objective, @Nullable DisplaySlot slot) {
      slots.values().removeIf(current -> current.equals(objective));
      if (slot != null) {
        var previous = slots.put(slot, objective);
        if (previous != null && !previous.equals(objective)) previous.setDisplaySlot(null);
      }
    }

    @Override
    protected void unregister(ObjectiveMock objective) {
      slots.values().removeIf(current -> current.equals(objective));
      objectives.remove(objective.getName());
    }
  }
}
