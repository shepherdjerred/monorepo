package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.Pairing;
import org.bukkit.entity.Player;

/** Confusion (I): the hostile monsters around the caster turn on each other. */
final class Confusion implements Spell {

  private final SpellSettings.Radius settings;
  private final Toolbox tools;

  Confusion(SpellSettings.Radius settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.CONFUSION;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var monsters = tools.targets().hostilesAround(caster, settings.radius());
    if (monsters.size() < 2) {
      return Result.err(CastProblem.noTarget("pair of monsters nearby"));
    }
    return Result.ok(
        () -> {
          for (var pair : Pairing.turnOnEachOther(monsters, tools.random())) {
            pair.attacker().setTarget(pair.target());
            tools.fx().burst(kind(), Magic.chest(pair.attacker()), 8, 0.3);
          }
          tools.fx().sound(kind(), Magic.at(caster));
        });
  }
}
