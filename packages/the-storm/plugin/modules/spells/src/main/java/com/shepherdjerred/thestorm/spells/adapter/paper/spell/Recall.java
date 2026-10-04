package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.Waypoints;
import com.shepherdjerred.thestorm.spells.domain.Refusal;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/**
 * Recall (I): returns the caster to their Mark, landing on the nearest safe spot, if they may still
 * enter that land. A Mark set before its world was sealed is refused, before anything is prepared
 * and again just before the teleport, so a seal that lands mid-cast still holds.
 */
final class Recall implements Spell {

  private final SpellSettings.Search settings;
  private final Toolbox tools;

  Recall(SpellSettings.Search settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.RECALL;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var mark =
        tools
            .waypoints()
            .of(caster.getUniqueId())
            .flatMap(waypoint -> Waypoints.locate(tools.server(), waypoint));
    if (mark.isEmpty()) {
      return Result.err(CastProblem.refused(new Refusal.NoMark()));
    }
    if (sealedDestination(mark.get())) {
      return Result.err(CastProblem.refused(new Refusal.SealedDestination()));
    }
    if (!tools.teleports().loadArea(mark.get(), settings.searchRadius())) {
      return Result.err(CastProblem.refused(new Refusal.DestinationLoading()));
    }
    return tools
        .teleports()
        .arrival(caster, mark.get(), settings.searchRadius())
        .map(
            destination ->
                guarded(
                    caster, destination, Magic.teleportEffect(kind(), tools, caster, destination)));
  }

  private boolean sealedDestination(Location destination) {
    return tools.sealed().isSealed(destination);
  }

  /** {@code effect}, refusing at commit time if the destination was sealed since preparation. */
  private Effect guarded(Player caster, Location destination, Effect effect) {
    return new Effect() {
      @Override
      public void beforeCommit(Runnable commit, Runnable failed) {
        if (sealedDestination(destination)) {
          tools.say().refusal(caster, new Refusal.SealedDestination());
          failed.run();
          return;
        }
        effect.beforeCommit(commit, failed);
      }

      @Override
      public void apply() {
        effect.apply();
      }
    };
  }
}
