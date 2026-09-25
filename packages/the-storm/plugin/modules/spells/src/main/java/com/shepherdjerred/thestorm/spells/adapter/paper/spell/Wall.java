package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.PaperNames;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.Facing;
import com.shepherdjerred.thestorm.spells.domain.geometry.Shapes;
import com.shepherdjerred.thestorm.spells.domain.temporary.Replaceability;
import java.time.Duration;
import org.bukkit.Material;
import org.bukkit.entity.Player;

/**
 * Wall (II): raises a temporary wall across the caster's view where they look. It fills only open
 * space in land they may build on, never where a creature stands, and always reverts.
 */
final class Wall implements Spell {

  private final SpellSettings.Wall settings;
  private final Toolbox tools;
  private final Material material;

  Wall(SpellSettings.Wall settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
    this.material =
        PaperNames.solid(settings.material())
            .orElseThrow(() -> new IllegalStateException("wall material " + settings.material()));
  }

  @Override
  public SpellKind kind() {
    return SpellKind.WALL;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    var hit = tools.targets().blockInSight(caster, settings.range());
    if (hit.isEmpty()) {
      return Result.err(CastProblem.noTarget("block in sight"));
    }
    var looked = hit.get();
    var face = looked.getHitBlockFace();
    var block = looked.getHitBlock();
    if (block == null || face == null) {
      return Result.err(CastProblem.noTarget("block in sight"));
    }
    var base = Aim.pos(block.getRelative(face));
    var facing = Facing.fromYaw(Magic.at(caster).getYaw());
    var positions = Shapes.wall(base, facing, settings.width(), settings.height());
    return Aim.buildable(
            tools, caster, Aim.blocks(caster.getWorld(), positions), Replaceability.Mode.OPEN_SPACE)
        .map(
            blocks ->
                () -> {
                  tools
                      .blocks()
                      .place(
                          blocks,
                          material.createBlockData(),
                          Duration.ofSeconds(settings.durationSeconds()));
                  blocks.forEach(
                      wallBlock ->
                          tools
                              .fx()
                              .burst(kind(), wallBlock.getLocation().add(0.5, 0.5, 0.5), 4, 0.3));
                  tools.fx().sound(kind(), block.getLocation());
                });
  }
}
