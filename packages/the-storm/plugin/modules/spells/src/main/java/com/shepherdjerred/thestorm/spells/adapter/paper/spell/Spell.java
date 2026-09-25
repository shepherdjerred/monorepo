package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import org.bukkit.entity.Player;

/**
 * One spell's behavior. {@link #prepare} does all targeting and protection checks and changes
 * nothing; only the returned {@link Effect} acts, and the caster pays just before it runs. A
 * refused preparation therefore costs nothing.
 */
public sealed interface Spell
    permits Blink,
        Carpet,
        ChainLightning,
        Cleanse,
        Confusion,
        Cripple,
        Disarm,
        Divine,
        Dowse,
        DrainLife,
        Entomb,
        Farm,
        FireNova,
        ForcePush,
        Freeze,
        Geyser,
        Haste,
        Leap,
        Mark,
        Phase,
        Purge,
        Recall,
        Roar,
        Shadowstep,
        ShiftSky,
        Silence,
        Stealth,
        StormCall,
        Thunderclap,
        Wall,
        Ward {

  SpellKind kind();

  Result<Effect, CastProblem> prepare(Player caster);
}
