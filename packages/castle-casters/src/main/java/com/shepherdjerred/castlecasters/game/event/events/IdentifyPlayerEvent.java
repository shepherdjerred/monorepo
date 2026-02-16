package com.shepherdjerred.castlecasters.game.event.events;

import com.shepherdjerred.castlecasters.common.player.PlayerInformation;
import com.shepherdjerred.castlecasters.events.Event;

/**
 * Tells the server who this player is.
 */
public record IdentifyPlayerEvent(PlayerInformation playerInformation) implements Event {

}
