package com.shepherdjerred.castlecasters.engine.events.input;

import com.shepherdjerred.castlecasters.engine.input.mouse.MouseButton;
import com.shepherdjerred.castlecasters.engine.input.mouse.MouseCoordinate;

public record MouseButtonDownEvent(MouseButton button, MouseCoordinate mouseCoordinate) implements InputEvent {

}
