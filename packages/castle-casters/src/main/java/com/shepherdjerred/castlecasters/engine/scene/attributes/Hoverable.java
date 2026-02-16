package com.shepherdjerred.castlecasters.engine.scene.attributes;

/**
 * An object that can be hovered over.
 */
public interface Hoverable extends Collidable {

  void onHover();

  void onUnhover();

  boolean isHovered();
}
