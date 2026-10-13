package com.shepherdjerred.thestorm.rwf.testing;

import com.destroystokyo.paper.entity.ai.Goal;
import com.destroystokyo.paper.entity.ai.GoalKey;
import com.destroystokyo.paper.entity.ai.GoalType;
import com.destroystokyo.paper.entity.ai.MobGoals;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.entity.Mob;

/**
 * Mob goals as a plain list per mob, since MockBukkit has none: tests read which goals a mob was
 * given, whether its own were cleared first, and drive the goals by hand.
 */
public final class FakeMobGoals implements MobGoals {

  /**
   * A goal and its priority.
   *
   * @param priority lower runs first
   * @param goal the goal
   */
  public record Entry(int priority, Goal<?> goal) {}

  private static final String UNUSED = "the rwf goals never read goals back; use goals(mob)";

  private final Map<UUID, List<Entry>> goals = new HashMap<>();
  private final Set<UUID> cleared = new HashSet<>();

  /** The goals {@code mob} was given, in the order given. */
  public List<Entry> goals(Mob mob) {
    return List.copyOf(goals.getOrDefault(mob.getUniqueId(), List.of()));
  }

  /** Whether {@code mob}'s own goals were all removed. */
  public boolean cleared(Mob mob) {
    return cleared.contains(mob.getUniqueId());
  }

  @Override
  public <T extends Mob> void addGoal(T mob, int priority, Goal<T> goal) {
    goals
        .computeIfAbsent(mob.getUniqueId(), ignored -> new ArrayList<>())
        .add(new Entry(priority, goal));
  }

  @Override
  public <T extends Mob> void removeGoal(T mob, Goal<T> goal) {
    goals
        .getOrDefault(mob.getUniqueId(), new ArrayList<>())
        .removeIf(entry -> entry.goal().equals(goal));
  }

  @Override
  public <T extends Mob> void removeAllGoals(T mob) {
    goals.remove(mob.getUniqueId());
    cleared.add(mob.getUniqueId());
  }

  @Override
  public <T extends Mob> void removeAllGoals(T mob, GoalType type) {
    goals
        .getOrDefault(mob.getUniqueId(), new ArrayList<>())
        .removeIf(entry -> entry.goal().getTypes().contains(type));
  }

  @Override
  public <T extends Mob> void removeGoal(T mob, GoalKey<T> key) {
    goals
        .getOrDefault(mob.getUniqueId(), new ArrayList<>())
        .removeIf(entry -> entry.goal().getKey().equals(key));
  }

  @Override
  public <T extends Mob> boolean hasGoal(T mob, GoalKey<T> key) {
    return goals.getOrDefault(mob.getUniqueId(), List.of()).stream()
        .anyMatch(entry -> entry.goal().getKey().equals(key));
  }

  @Override
  public <T extends Mob> Goal<T> getGoal(T mob, GoalKey<T> key) {
    throw new UnsupportedOperationException(UNUSED);
  }

  @Override
  public <T extends Mob> Collection<Goal<T>> getGoals(T mob, GoalKey<T> key) {
    throw new UnsupportedOperationException(UNUSED);
  }

  @Override
  public <T extends Mob> Collection<Goal<T>> getAllGoals(T mob) {
    throw new UnsupportedOperationException(UNUSED);
  }

  @Override
  public <T extends Mob> Collection<Goal<T>> getAllGoals(T mob, GoalType type) {
    throw new UnsupportedOperationException(UNUSED);
  }

  @Override
  public <T extends Mob> Collection<Goal<T>> getAllGoalsWithout(T mob, GoalType type) {
    throw new UnsupportedOperationException(UNUSED);
  }

  @Override
  public <T extends Mob> Collection<Goal<T>> getRunningGoals(T mob) {
    return List.of();
  }

  @Override
  public <T extends Mob> Collection<Goal<T>> getRunningGoals(T mob, GoalType type) {
    return List.of();
  }

  @Override
  public <T extends Mob> Collection<Goal<T>> getRunningGoalsWithout(T mob, GoalType type) {
    return List.of();
  }
}
