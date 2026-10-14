package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.players.PlayerVisibilityControl;
import java.util.Collection;
import java.util.HashSet;
import java.util.Set;
import java.util.function.BiPredicate;
import org.bukkit.entity.Player;

/** One owner for composed combatant visibility; Paper hide/show is per plugin, not per feature. */
final class CombatantVisibility {
  private record View(Player viewer, Player target) {}

  private final PlayerVisibilityControl control;
  private final BiPredicate<Player, Player> obscured;
  private final Set<View> hidden = new HashSet<>();

  CombatantVisibility(PlayerVisibilityControl control, BiPredicate<Player, Player> obscured) {
    this.control = control;
    this.obscured = obscured;
  }

  boolean active() {
    return !hidden.isEmpty();
  }

  void refresh(Collection<Player> viewers, Collection<Player> targets) {
    var desired = new HashSet<View>();
    for (var viewer : viewers) {
      for (var target : targets) {
        if (!viewer.equals(target)
            && viewer.getWorld().equals(target.getWorld())
            && obscured.test(viewer, target)) desired.add(new View(viewer, target));
      }
    }
    for (var view : Set.copyOf(hidden)) {
      if (!desired.contains(view)) show(view);
    }
    for (var view : desired) {
      if (hidden.add(view))
        control.set(view.viewer(), view.target(), PlayerVisibilityControl.Reason.COMBAT, true);
    }
  }

  void clear(Player player) {
    for (var view : Set.copyOf(hidden)) {
      if (view.viewer().equals(player) || view.target().equals(player)) show(view);
    }
  }

  void reset() {
    for (var view : Set.copyOf(hidden)) show(view);
  }

  private void show(View view) {
    hidden.remove(view);
    control.set(view.viewer(), view.target(), PlayerVisibilityControl.Reason.COMBAT, false);
  }
}
