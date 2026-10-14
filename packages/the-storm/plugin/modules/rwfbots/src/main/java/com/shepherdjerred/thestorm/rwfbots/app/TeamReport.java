package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwfbots.domain.team.SharedSighting;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;

/** A bot's observation awaiting a completed team call; never permission to reveal current truth. */
public record TeamReport(int generation, int lifeEpoch, TeamId team, SharedSighting sighting) {}
