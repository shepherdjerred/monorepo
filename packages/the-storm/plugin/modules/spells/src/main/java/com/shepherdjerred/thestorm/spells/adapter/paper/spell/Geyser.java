package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.Harm;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import org.bukkit.entity.Player;

/** Geyser (II): a column of water throws the creature in sight into the air. */
final class Geyser implements Spell {

  private final SpellSettings.Geyser settings;
  private final Toolbox tools;

  Geyser(SpellSettings.Geyser settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.GEYSER;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    return Aim.creature(tools, caster, settings.range())
        .map(
            target ->
                () -> {
                  var launch = target.getVelocity().setY(settings.lift());
                  var blow = Harm.Blow.none().withDamage(settings.damage()).withVelocity(launch);
                  if (!tools.harm().strike(caster, target, blow)) {
                    return;
                  }
                  var base = target.getLocation();
                  for (var up = 0; up < 3; up++) {
                    tools.fx().burst(kind(), base.clone().add(0, up, 0), 12, 0.3);
                  }
                  tools.fx().sound(kind(), base);
                });
  }
}
