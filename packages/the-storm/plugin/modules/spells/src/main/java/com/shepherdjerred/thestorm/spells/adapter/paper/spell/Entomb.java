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

/**
 * Entomb (IV): seals the creature in sight in a temporary tomb for a few seconds. The target must
 * be one the caster may harm (a player only where PvP is on), and the tomb fills only open space
 * where the caster may build.
 */
final class Entomb implements Spell {

  private final SpellSettings.Entomb settings;
  private final Toolbox tools;
  private final Material material;

  Entomb(SpellSettings.Entomb settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
    this.material =
        PaperNames.solid(settings.material())
            .orElseThrow(() -> new IllegalStateException("entomb material " + settings.material()));
  }

  @Override
  public SpellKind kind() {
    return SpellKind.ENTOMB;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    return Aim.creature(tools, caster, settings.range())
        .flatMap(
            target -> {
              var feet = Aim.pos(target.getLocation().getBlock());
              var height = Math.max(1, (int) Math.ceil(target.getHeight()));
              var shell = Aim.blocks(target.getWorld(), Shapes.tomb(feet, height));
              return Aim.buildable(tools, caster, shell, Replaceability.Mode.OPEN_SPACE)
                  .map(
                      blocks ->
                          () -> {
                            tools
                                .blocks()
                                .place(
                                    blocks,
                                    material.createBlockData(),
                                    Duration.ofSeconds(settings.durationSeconds()));
                            tools.fx().cast(kind(), Magic.chest(target));
                          });
            });
  }
}
