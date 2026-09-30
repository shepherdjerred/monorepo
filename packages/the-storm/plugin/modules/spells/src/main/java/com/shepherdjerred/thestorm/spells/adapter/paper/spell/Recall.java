package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.Waypoints;
import com.shepherdjerred.thestorm.spells.domain.Refusal;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import org.bukkit.entity.Player;

/**
 * Recall (I): returns the caster to their Mark, landing on the nearest safe spot, if they may still
 * enter that land.
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
    if (!tools.teleports().loadArea(mark.get(), settings.searchRadius())) {
      return Result.err(CastProblem.refused(new Refusal.DestinationLoading()));
    }
    return tools
        .teleports()
        .arrival(caster, mark.get(), settings.searchRadius())
        .map(destination -> Magic.teleportEffect(kind(), tools, caster, destination));
  }
}
