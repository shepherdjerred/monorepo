package com.shepherdjerred.castlecasters.engine.events.input;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.ToString;

@Getter
@ToString
@AllArgsConstructor
public class MouseScrollEvent implements InputEvent {

  private final int xScroll;
  private final int yScroll;
}
