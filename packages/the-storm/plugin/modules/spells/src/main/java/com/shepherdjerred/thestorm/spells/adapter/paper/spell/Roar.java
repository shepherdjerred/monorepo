package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import org.bukkit.entity.Player;

/** Roar (I): every hostile monster around the caster turns to fight them, sparing their friends. */
final class Roar implements Spell {

  private final SpellSettings.Radius settings;
  private final Toolbox tools;

  Roar(SpellSettings.Radius settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.ROAR;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var monsters = tools.targets().hostilesAround(caster, settings.radius());
    if (monsters.isEmpty()) {
      return Result.err(CastProblem.noTarget("monster nearby"));
    }
    return Result.ok(
        () -> {
          monsters.forEach(monster -> monster.setTarget(caster));
          tools.fx().cast(kind(), Magic.at(caster));
          tools.fx().ring(kind(), Magic.at(caster), settings.radius());
        });
  }
}
