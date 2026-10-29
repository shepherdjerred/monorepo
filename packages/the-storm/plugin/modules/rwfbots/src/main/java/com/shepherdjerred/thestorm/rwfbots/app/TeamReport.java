package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwfbots.domain.team.Callout;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SharedSighting;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;

/**
 * A bot's observation awaiting a completed team call; never permission to reveal current truth.
 *
 * @param generation the match it was seen in
 * @param lifeEpoch the reporter's life it was seen in
 * @param team the reporter's team
 * @param sighting what was seen
 * @param callout how it is called out in team chat
 * @param usefulness how far it lies from the team's nearest human, where they stand or are heading
 *     ({@link com.shepherdjerred.thestorm.rwfbots.domain.team.TeamCallouts#usefulness}); calls
 *     nearer a human go first
 */
public record TeamReport(
    int generation,
    int lifeEpoch,
    TeamId team,
    SharedSighting sighting,
    Callout callout,
    double usefulness) {}
