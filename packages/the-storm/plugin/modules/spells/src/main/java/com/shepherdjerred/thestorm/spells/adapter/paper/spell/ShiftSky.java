package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.geometry.PersonalTime;
import java.time.Duration;
import org.bukkit.entity.Player;

/**
 * Dawn and Dusk (III): the caster's own sky jumps to morning or evening for a while. Only the
 * caster sees it; the world's time never changes, and the sun keeps moving from the new time.
 */
final class ShiftSky implements Spell {

  private final SpellKind kind;
  private final SpellSettings.TimeShift settings;
  private final Toolbox tools;

  ShiftSky(SpellKind kind, SpellSettings.TimeShift settings, Toolbox tools) {
    if (kind != SpellKind.DAWN && kind != SpellKind.DUSK) {
      throw new IllegalArgumentException("ShiftSky is Dawn or Dusk, not " + kind);
    }
    this.kind = kind;
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return kind;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    return Result.ok(
        () -> {
          var offset = PersonalTime.offset(caster.getWorld().getTime(), settings.targetTime());
          caster.setPlayerTime(offset, true);
          tools
              .state()
              .timeShifts()
              .start(
                  caster.getUniqueId(),
                  Duration.ofMinutes(settings.durationMinutes()),
                  tools.time().instant());
          tools.fx().cast(kind, Magic.at(caster));
        });
  }
}
