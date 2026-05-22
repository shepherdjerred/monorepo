package com.shepherdjerred.castlecasters.game.network.event;

import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.game.network.client.state.NetworkClientState;

public record TransitionClientStateEvent(NetworkClientState newState) implements Event {

}
