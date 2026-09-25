package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.potion.PotionEffectTypeCategory;

/** Cleanse (I, learned in a quest): clears the caster's harmful effects, fire and frost. */
final class Cleanse implements Spell {

  private final Toolbox tools;

  Cleanse(Toolbox tools) {
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.CLEANSE;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var harmful =
        caster.getActivePotionEffects().stream()
            .map(PotionEffect::getType)
            .filter(type -> type.getCategory() == PotionEffectTypeCategory.HARMFUL)
            .toList();
    if (harmful.isEmpty() && caster.getFireTicks() <= 0 && caster.getFreezeTicks() <= 0) {
      return Result.err(CastProblem.noTarget("affliction"));
    }
    return Result.ok(
        () -> {
          for (PotionEffectType type : harmful) {
            caster.removePotionEffect(type);
          }
          caster.setFireTicks(0);
          caster.setFreezeTicks(0);
          tools.fx().cast(kind(), Magic.chest(caster));
        });
  }
}
