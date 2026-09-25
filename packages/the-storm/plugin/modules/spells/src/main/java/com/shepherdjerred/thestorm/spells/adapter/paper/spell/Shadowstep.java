package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.Teleports;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.Knockback;
import org.bukkit.Location;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

/**
 * Shadowstep (II): the caster steps behind the creature in sight, facing its back, landing on a
 * safe spot in land they may enter.
 */
final class Shadowstep implements Spell {

  private static final double BEHIND = 1.5;
  private static final int SEARCH_RADIUS = 1;

  private final SpellSettings.Range settings;
  private final Toolbox tools;

  Shadowstep(SpellSettings.Range settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.SHADOWSTEP;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var target = tools.targets().inSight(caster, settings.range());
    if (target.isEmpty()) {
      return Result.err(CastProblem.noTarget("creature in sight"));
    }
    var from = Magic.at(caster);
    return tools
        .teleports()
        .arrival(caster, behind(target.get()), SEARCH_RADIUS)
        .map(
            destination ->
                () -> {
                  tools.fx().cast(kind(), from);
                  Teleports.teleport(caster, destination);
                  tools.fx().cast(kind(), destination);
                });
  }

  private static Location behind(LivingEntity target) {
    var at = target.getLocation();
    var spot = Knockback.behind(Magic.vec(at), at.getYaw(), BEHIND);
    return new Location(at.getWorld(), spot.x(), spot.y(), spot.z(), at.getYaw(), 0);
  }
}
