package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import org.bukkit.entity.Player;

/**
 * Fire Nova (I): a ring of flame bursts from the caster, burning and hurting every creature around
 * them that they may harm. It sets creatures alight, never blocks.
 */
final class FireNova implements Spell {

  private final SpellSettings.Nova settings;
  private final Toolbox tools;

  FireNova(SpellSettings.Nova settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.FIRENOVA;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    return Aim.creaturesAround(tools, caster, settings.radius())
        .map(
            victims ->
                () -> {
                  var fireTicks = Magic.ticks(settings.fireSeconds());
                  for (var victim : victims) {
                    Magic.hurt(victim, settings.damage(), caster);
                    victim.setFireTicks(Math.max(victim.getFireTicks(), fireTicks));
                  }
                  tools.fx().sound(kind(), Magic.at(caster));
                  tools.fx().ring(kind(), Magic.at(caster), settings.radius());
                });
  }
}
