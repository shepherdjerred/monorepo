package com.shepherdjerred.castlecasters.engine.events.handlers;

import com.shepherdjerred.castlecasters.engine.events.ToggleWireframeEvent;
import com.shepherdjerred.castlecasters.engine.graphics.OpenGlHelper;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import lombok.extern.log4j.Log4j2;

@Log4j2
public class ToggleWireframeEventHandler implements EventHandler<ToggleWireframeEvent> {

  private boolean isWireframe = false;

  @Override
  public void handle(ToggleWireframeEvent toggleWireframeEvent) {
    isWireframe = !isWireframe;
    if (isWireframe) {
      OpenGlHelper.enableWireframe();
    } else {
      OpenGlHelper.disableWireframe();
    }
    log.info("Wireframe: {}", isWireframe);
  }
}
