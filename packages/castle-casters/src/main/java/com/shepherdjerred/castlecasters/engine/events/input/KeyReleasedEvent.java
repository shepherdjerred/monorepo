package com.shepherdjerred.castlecasters.engine.events.input;

import com.shepherdjerred.castlecasters.engine.input.keyboard.Key;

public record KeyReleasedEvent(Key key) implements InputEvent {

}
