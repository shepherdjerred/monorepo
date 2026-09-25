package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffectType;

/** Cripple (I): slows and weakens the creature in sight. */
final class Cripple implements Spell {

  private final SpellSettings.Afflict settings;
  private final Toolbox tools;

  Cripple(SpellSettings.Afflict settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.CRIPPLE;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    return Aim.creature(tools, caster, settings.range())
        .map(
            target ->
                () -> {
                  Magic.potion(
                      target,
                      PotionEffectType.SLOWNESS,
                      settings.durationSeconds(),
                      settings.amplifier());
                  Magic.potion(
                      target,
                      PotionEffectType.WEAKNESS,
                      settings.durationSeconds(),
                      settings.amplifier());
                  tools.fx().line(kind(), caster.getEyeLocation(), Magic.chest(target));
                  tools.fx().cast(kind(), Magic.chest(target));
                });
  }
}
