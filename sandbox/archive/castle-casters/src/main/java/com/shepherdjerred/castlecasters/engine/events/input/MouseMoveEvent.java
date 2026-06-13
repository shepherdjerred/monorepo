package com.shepherdjerred.castlecasters.engine.events.input;

import com.shepherdjerred.castlecasters.engine.input.mouse.MouseCoordinate;

public record MouseMoveEvent(MouseCoordinate newMousePosition) implements InputEvent {

}
