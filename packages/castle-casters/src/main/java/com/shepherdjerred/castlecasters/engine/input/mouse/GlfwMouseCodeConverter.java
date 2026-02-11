package com.shepherdjerred.castlecasters.engine.input.mouse;

import java.util.Optional;

import static com.shepherdjerred.castlecasters.engine.input.mouse.MouseButton.LEFT;
import static com.shepherdjerred.castlecasters.engine.input.mouse.MouseButton.RIGHT;
import static org.lwjgl.glfw.GLFW.GLFW_MOUSE_BUTTON_LEFT;
import static org.lwjgl.glfw.GLFW.GLFW_MOUSE_BUTTON_RIGHT;

/**
 * Converts GLFW mouse codes to a MouseButton enum.
 */
public class GlfwMouseCodeConverter {
  public Optional<MouseButton> fromGlfwButton(int glfwButton) {
    MouseButton mouseButton = switch (glfwButton) {
      case GLFW_MOUSE_BUTTON_LEFT -> LEFT;
      case GLFW_MOUSE_BUTTON_RIGHT -> RIGHT;
      default -> null;
    };

    if (mouseButton == null) {
      return Optional.empty();
    } else {
      return Optional.of(mouseButton);
    }
  }
}
