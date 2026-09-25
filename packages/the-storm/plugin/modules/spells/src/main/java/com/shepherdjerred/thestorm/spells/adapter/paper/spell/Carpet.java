package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.PaperNames;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.Shapes;
import com.shepherdjerred.thestorm.spells.domain.temporary.Replaceability;
import java.time.Duration;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffectType;

/**
 * Carpet (III, learned in a quest): a small cloud, like a happy ghast's back, forms under the
 * caster's feet for a few seconds, filling only open air where they may build. When it melts away
 * the caster drifts down on slow falling, so it is safe to use over a drop.
 */
final class Carpet implements Spell {

  /** Slow falling outlasts the cloud by this much. */
  private static final int SOFT_LANDING_SECONDS = 5;

  private final SpellSettings.Carpet settings;
  private final Toolbox tools;
  private final Material material;

  Carpet(SpellSettings.Carpet settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
    this.material =
        PaperNames.solid(settings.material())
            .orElseThrow(() -> new IllegalStateException("carpet material " + settings.material()));
  }

  @Override
  public SpellKind kind() {
    return SpellKind.CARPET;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var under = Aim.pos(Magic.at(caster).getBlock()).below();
    var cloud = Aim.blocks(caster.getWorld(), Shapes.platform(under, settings.size()));
    return Aim.buildable(tools, caster, cloud, Replaceability.Mode.OPEN_SPACE)
        .map(
            blocks ->
                () -> {
                  tools
                      .blocks()
                      .place(
                          blocks,
                          material.createBlockData(),
                          Duration.ofSeconds(settings.durationSeconds()));
                  Magic.potion(
                      caster,
                      PotionEffectType.SLOW_FALLING,
                      settings.durationSeconds() + SOFT_LANDING_SECONDS,
                      0);
                  tools.fx().cast(kind(), Magic.at(caster));
                  tools.fx().ring(kind(), Magic.at(caster), settings.size() / 2.0 + 0.5);
                });
  }
}
