package com.shepherdjerred.castlecasters.server.event;

import com.shepherdjerred.castlecasters.common.player.PlayerInformation;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.server.network.server.Connection;

public record PlayerInformationReceivedEvent(PlayerInformation playerInformation,
                                             Connection connection) implements Event {

}
