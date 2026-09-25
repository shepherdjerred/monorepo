package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import java.time.Duration;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/**
 * Stealth (II): the caster turns invisible and monsters lose track of them for a short while.
 * Attacking anything ends it at once.
 */
final class Stealth implements Spell {

  private final SpellSettings.Timed settings;
  private final Toolbox tools;

  Stealth(SpellSettings.Timed settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.STEALTH;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    return Result.ok(
        () -> {
          tools.fx().cast(kind(), Magic.chest(caster));
          caster.addPotionEffect(
              new PotionEffect(
                  PotionEffectType.INVISIBILITY,
                  Magic.ticks(settings.durationSeconds()),
                  0,
                  false,
                  false,
                  true));
          tools
              .state()
              .stealth()
              .start(
                  caster.getUniqueId(),
                  Duration.ofSeconds(settings.durationSeconds()),
                  tools.time().instant());
        });
  }
}
