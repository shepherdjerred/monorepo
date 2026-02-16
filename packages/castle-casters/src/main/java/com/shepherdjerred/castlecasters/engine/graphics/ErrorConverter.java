package com.shepherdjerred.castlecasters.engine.graphics;

import static org.lwjgl.opengl.ARBImaging.GL_TABLE_TOO_LARGE;
import static org.lwjgl.opengl.GL11.*;
import static org.lwjgl.opengl.GL30.GL_INVALID_FRAMEBUFFER_OPERATION;

// https://github.com/LWJGL/lwjgl/blob/master/src/java/org/lwjgl/opengl/Util.java
public class ErrorConverter {

  /**
   * Translate a GL error code to a String describing the error
   */
  public String convert(int errorCode) {
    return switch (errorCode) {
      case GL_NO_ERROR -> "No error";
      case GL_INVALID_ENUM -> "Invalid enum";
      case GL_INVALID_VALUE -> "Invalid value";
      case GL_INVALID_OPERATION -> "Invalid operation";
      case GL_STACK_OVERFLOW -> "Stack overflow";
      case GL_STACK_UNDERFLOW -> "Stack underflow";
      case GL_OUT_OF_MEMORY -> "Out of memory";
      case GL_TABLE_TOO_LARGE -> "Table too large";
      case GL_INVALID_FRAMEBUFFER_OPERATION -> "Invalid framebuffer operation";
      default -> null;
    };
  }
}
