package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import org.bukkit.entity.Player;
import org.bukkit.event.entity.EntityRegainHealthEvent;

/** Drain Life (III): hurts the creature in sight and heals the caster by part of the damage. */
final class DrainLife implements Spell {

  private final SpellSettings.Drain settings;
  private final Toolbox tools;

  DrainLife(SpellSettings.Drain settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.DRAINLIFE;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    return Aim.creature(tools, caster, settings.range())
        .map(
            target ->
                () -> {
                  var before = target.getHealth();
                  Magic.hurt(target, settings.damage(), caster);
                  var dealt = Math.max(0, before - target.getHealth());
                  if (dealt > 0 && settings.healRatio() > 0) {
                    caster.heal(
                        dealt * settings.healRatio(), EntityRegainHealthEvent.RegainReason.MAGIC);
                  }
                  tools.fx().line(kind(), Magic.chest(target), Magic.chest(caster));
                  tools.fx().sound(kind(), Magic.at(caster));
                });
  }
}
