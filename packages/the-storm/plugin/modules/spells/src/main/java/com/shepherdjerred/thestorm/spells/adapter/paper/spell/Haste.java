package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffectType;

/** Haste (I): the caster runs and digs faster for a while. */
final class Haste implements Spell {

  private final SpellSettings.Buff settings;
  private final Toolbox tools;

  Haste(SpellSettings.Buff settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.HASTE;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    return Result.ok(
        () -> {
          Magic.potion(
              caster, PotionEffectType.SPEED, settings.durationSeconds(), settings.amplifier());
          Magic.potion(
              caster, PotionEffectType.HASTE, settings.durationSeconds(), settings.amplifier());
          tools.fx().cast(kind(), Magic.at(caster));
        });
  }
}
