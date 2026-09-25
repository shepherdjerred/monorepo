package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.Harm;
import com.shepherdjerred.thestorm.spells.adapter.paper.Teleports;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.Knockback;
import org.bukkit.Location;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

/**
 * Shadowstep (II): the caster steps behind the creature in sight, facing its back. Sneaking up on a
 * creature counts as harming it, so the caster must be allowed to; the landing is a safe spot in
 * land they may teleport into, with nothing solid between it and the creature.
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
    return Aim.creature(tools, caster, settings.range()).flatMap(target -> step(caster, target));
  }

  private Result<Effect, CastProblem> step(Player caster, LivingEntity target) {
    var from = Magic.at(caster);
    var eyes = target.getEyeLocation();
    return tools
        .teleports()
        .arrival(caster, behind(target), SEARCH_RADIUS, spot -> Teleports.clearPath(eyes, spot))
        .map(
            destination ->
                () -> {
                  var sneak =
                      Harm.Blow.none().then(victim -> Teleports.teleport(caster, destination));
                  if (tools.harm().strike(caster, target, sneak)) {
                    tools.fx().cast(kind(), from);
                    tools.fx().cast(kind(), destination);
                  }
                });
  }

  private static Location behind(LivingEntity target) {
    var at = target.getLocation();
    var spot = Knockback.behind(Magic.vec(at), at.getYaw(), BEHIND);
    return new Location(at.getWorld(), spot.x(), spot.y(), spot.z(), at.getYaw(), 0);
  }
}
