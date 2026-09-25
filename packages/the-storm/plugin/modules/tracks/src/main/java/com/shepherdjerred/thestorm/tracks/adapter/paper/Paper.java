package com.shepherdjerred.thestorm.tracks.adapter.paper;

import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import java.time.Duration;
import java.time.InstantSource;
import org.bukkit.Server;

/**
 * The Paper services the commands use.
 *
 * @param server the server, for online players
 * @param players everyone who has ever joined, for naming offline players
 * @param replies messages and main-thread completion
 * @param time the clock, for confirmations and cooldowns
 * @param confirmWindow how long a two-step confirmation stays open
 */
record Paper(
    Server server,
    PlayerDirectory players,
    Replies replies,
    InstantSource time,
    Duration confirmWindow) {}
