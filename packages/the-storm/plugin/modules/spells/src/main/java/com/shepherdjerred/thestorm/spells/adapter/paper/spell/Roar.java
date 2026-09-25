package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.Harm;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;

/**
 * Roar (I): every hostile monster the caster can see turns to fight them, sparing their friends.
 * Monsters on land where the caster may not build are left alone.
 */
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
    var taunt =
        Harm.Blow.none()
            .then(
                monster -> {
                  if (monster instanceof Mob mob) {
                    mob.setTarget(caster);
                  }
                });
    return Aim.hostiles(tools, caster, settings.radius(), "monster nearby")
        .map(
            monsters ->
                () -> {
                  monsters.forEach(monster -> tools.harm().strike(caster, monster, taunt));
                  tools.fx().cast(kind(), Magic.at(caster));
                  tools.fx().ring(kind(), Magic.at(caster), settings.radius());
                });
  }
}
