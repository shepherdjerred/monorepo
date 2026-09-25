package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import org.bukkit.entity.Player;

/** Purge (IV): a wave of light strikes every hostile monster around the caster. */
final class Purge implements Spell {

  private final SpellSettings.AreaDamage settings;
  private final Toolbox tools;

  Purge(SpellSettings.AreaDamage settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.PURGE;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var monsters = tools.targets().hostilesAround(caster, settings.radius());
    if (monsters.isEmpty()) {
      return Result.err(CastProblem.noTarget("monster nearby"));
    }
    return Result.ok(
        () -> {
          for (var monster : monsters) {
            Magic.hurt(monster, settings.damage(), caster);
            tools.fx().burst(kind(), Magic.chest(monster), 10, 0.3);
          }
          tools.fx().sound(kind(), Magic.at(caster));
          tools.fx().ring(kind(), Magic.at(caster), settings.radius());
        });
  }
}
