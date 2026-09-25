package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.spells.adapter.paper.Fx;
import com.shepherdjerred.thestorm.spells.adapter.paper.Guard;
import com.shepherdjerred.thestorm.spells.adapter.paper.Say;
import com.shepherdjerred.thestorm.spells.adapter.paper.SpellState;
import com.shepherdjerred.thestorm.spells.adapter.paper.Targets;
import com.shepherdjerred.thestorm.spells.adapter.paper.Teleports;
import com.shepherdjerred.thestorm.spells.adapter.paper.TemporaryBlocks;
import com.shepherdjerred.thestorm.spells.adapter.paper.Waypoints;
import java.time.InstantSource;
import java.util.random.RandomGenerator;
import org.bukkit.Server;

/**
 * What spells share: targeting, the protection guard, safe teleports, temporary blocks, runtime
 * state, Marks, effects, the clock and randomness.
 */
public record Toolbox(
    Targets targets,
    Guard guard,
    Teleports teleports,
    TemporaryBlocks blocks,
    SpellState state,
    Waypoints waypoints,
    Fx fx,
    Say say,
    Server server,
    InstantSource time,
    RandomGenerator random) {}
