package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.Harm;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import org.bukkit.entity.Player;

/**
 * Fire Nova (I): a ring of flame bursts from the caster, burning and hurting every creature they
 * can see around them that they may harm. It sets creatures alight, never blocks.
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
    var blow =
        Harm.Blow.none()
            .withDamage(settings.damage())
            .withFire(Magic.ticks(settings.fireSeconds()));
    return Aim.creaturesAround(tools, caster, settings.radius())
        .map(
            victims ->
                () -> {
                  victims.forEach(victim -> tools.harm().strike(caster, victim, blow));
                  tools.fx().sound(kind(), Magic.at(caster));
                  tools.fx().ring(kind(), Magic.at(caster), settings.radius());
                });
  }
}
