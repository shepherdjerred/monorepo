package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.Knockback;
import java.time.Duration;
import org.bukkit.entity.Player;

/** Leap (III): launches the caster forward and up; the landing does not hurt. */
final class Leap implements Spell {

  /** How long the soft landing lasts at most, in case the caster never lands. */
  private static final Duration FEATHER_FALL = Duration.ofSeconds(10);

  private final SpellSettings.Leap settings;
  private final Toolbox tools;

  Leap(SpellSettings.Leap settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.LEAP;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    return Result.ok(
        () -> {
          var velocity =
              Knockback.leap(Magic.at(caster).getYaw(), settings.forward(), settings.upward());
          caster.setVelocity(Magic.vector(velocity));
          tools
              .state()
              .featherFall()
              .start(caster.getUniqueId(), FEATHER_FALL, tools.time().instant());
          tools.fx().cast(kind(), Magic.at(caster));
        });
  }
}
