package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.Harm;
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
    var ticks = Magic.ticks(settings.durationSeconds());
    var blow =
        Harm.Blow.none()
            .withPotion(PotionEffectType.SLOWNESS, ticks, settings.amplifier())
            .withPotion(PotionEffectType.WEAKNESS, ticks, settings.amplifier());
    return Aim.creature(tools, caster, settings.range())
        .map(
            target ->
                () -> {
                  if (tools.harm().strike(caster, target, blow)) {
                    tools.fx().line(kind(), caster.getEyeLocation(), Magic.chest(target));
                    tools.fx().cast(kind(), Magic.chest(target));
                  }
                });
  }
}
