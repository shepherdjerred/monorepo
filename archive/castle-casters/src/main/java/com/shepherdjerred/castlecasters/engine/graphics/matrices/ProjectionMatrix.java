package com.shepherdjerred.castlecasters.engine.graphics.matrices;

import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import org.joml.Matrix4f;

public record ProjectionMatrix(WindowSize windowSize) {

  // https://gamedev.stackexchange.com/questions/59161/is-opengl-appropriate-for-2d-games
  // https://en.wikibooks.org/wiki/OpenGL_Programming/Modern_OpenGL_Tutorial_2D
  public Matrix4f getMatrix() {
    return new Matrix4f().ortho(0, windowSize.width(), windowSize.height(), 0, 1000, -1000);
  }
}
