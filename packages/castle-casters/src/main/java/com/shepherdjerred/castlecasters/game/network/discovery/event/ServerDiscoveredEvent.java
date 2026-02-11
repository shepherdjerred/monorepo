package com.shepherdjerred.castlecasters.game.network.discovery.event;

import com.shepherdjerred.castlecasters.game.network.discovery.ServerInformation;
import com.shepherdjerred.castlecasters.game.network.event.NetworkEvent;

public record ServerDiscoveredEvent(ServerInformation serverInformation) implements NetworkEvent {

}
