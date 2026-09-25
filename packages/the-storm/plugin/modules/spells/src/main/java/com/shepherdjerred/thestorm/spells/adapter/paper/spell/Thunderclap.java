package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.Knockback;
import org.bukkit.entity.Player;

/**
 * Thunderclap (V): the caster claps thunder; a shockwave hurts and throws back every creature
 * around them that they may harm.
 */
final class Thunderclap implements Spell {

  private static final double LIFT = 0.4;

  private final SpellSettings.Thunderclap settings;
  private final Toolbox tools;

  Thunderclap(SpellSettings.Thunderclap settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.THUNDERCLAP;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    return Aim.creaturesAround(tools, caster, settings.radius())
        .map(
            victims ->
                () -> {
                  var centre = Magic.vec(Magic.at(caster));
                  for (var victim : victims) {
                    Magic.hurt(victim, settings.damage(), caster);
                    var push =
                        Knockback.away(
                            centre, Magic.vec(victim.getLocation()), settings.knockback(), LIFT);
                    victim.setVelocity(Magic.vector(push));
                  }
                  tools.fx().cast(kind(), Magic.at(caster));
                  tools.fx().ring(kind(), Magic.at(caster), settings.radius());
                });
  }
}
