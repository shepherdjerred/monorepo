package com.shepherdjerred.castlecasters.engine.events;

import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import com.shepherdjerred.castlecasters.events.Event;

public record LogicalWindowResizeEvent(WindowSize size) implements Event {}
