package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.Harm;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.Knockback;
import org.bukkit.entity.Player;

/** Force Push (II): a gale shoves every creature the caster can see around them away. */
final class ForcePush implements Spell {

  private final SpellSettings.Push settings;
  private final Toolbox tools;

  ForcePush(SpellSettings.Push settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.FORCEPUSH;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    return Aim.creaturesAround(tools, caster, settings.radius())
        .map(
            victims ->
                () -> {
                  var centre = Magic.vec(Magic.at(caster));
                  for (var victim : victims) {
                    var push =
                        Knockback.away(
                            centre,
                            Magic.vec(victim.getLocation()),
                            settings.strength(),
                            settings.lift());
                    tools
                        .harm()
                        .strike(caster, victim, Harm.Blow.none().withVelocity(Magic.vector(push)));
                  }
                  tools.fx().cast(kind(), Magic.at(caster));
                  tools.fx().ring(kind(), Magic.at(caster), settings.radius());
                });
  }
}
