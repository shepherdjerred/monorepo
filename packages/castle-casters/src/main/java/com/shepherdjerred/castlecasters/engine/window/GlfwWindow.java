package com.shepherdjerred.castlecasters.engine.window;

import com.shepherdjerred.castlecasters.engine.events.CloseApplicationEvent;
import com.shepherdjerred.castlecasters.engine.events.WindowResizeEvent;
import com.shepherdjerred.castlecasters.engine.events.input.*;
import com.shepherdjerred.castlecasters.engine.input.keyboard.GlfwKeyCodeConverter;
import com.shepherdjerred.castlecasters.engine.input.keyboard.Key;
import com.shepherdjerred.castlecasters.engine.input.mouse.GlfwMouseCodeConverter;
import com.shepherdjerred.castlecasters.engine.input.mouse.MouseButton;
import com.shepherdjerred.castlecasters.engine.input.mouse.MouseCoordinate;
import com.shepherdjerred.castlecasters.engine.input.mouse.MouseTracker;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import lombok.Getter;
import lombok.extern.log4j.Log4j2;
import org.lwjgl.glfw.Callbacks;
import org.lwjgl.glfw.GLFWErrorCallback;
import org.lwjgl.glfw.GLFWVidMode;
import org.lwjgl.opengl.GL;
import org.lwjgl.system.Configuration;

import java.util.Optional;

import static org.lwjgl.glfw.GLFW.*;
import static org.lwjgl.opengl.GL11.GL_FALSE;
import static org.lwjgl.opengl.GL11.GL_TRUE;
import static org.lwjgl.system.MemoryUtil.NULL;

@Log4j2
public class GlfwWindow implements Window {

  @Getter
  private final WindowSettings windowSettings;
  private final GlfwKeyCodeConverter keyCodeConverter;
  private final GlfwMouseCodeConverter mouseCodeConverter;
  private final EventBus<Event> eventBus;
  private final MouseTracker mouseTracker;
  private long windowHandle;
  private boolean shouldClose;

  public GlfwWindow(WindowSettings windowSettings,
                    MouseTracker mouseTracker,
                    EventBus<Event> eventBus) {
    this.windowSettings = windowSettings;
    this.keyCodeConverter = new GlfwKeyCodeConverter();
    this.mouseCodeConverter = new GlfwMouseCodeConverter();
    this.eventBus = eventBus;
    this.mouseTracker = mouseTracker;
    eventBus.registerHandler(CloseApplicationEvent.class, event -> shouldClose = true);
  }

  @Override
  public void initialize() {
    if (windowSettings.isDebugEnabled()) {
      Configuration.DEBUG.set(true);
      Configuration.DEBUG_LOADER.set(true);
      Configuration.DEBUG_MEMORY_ALLOCATOR.set(true);
      Configuration.DEBUG_STACK.set(true);
      Configuration.DEBUG_STREAM.set(System.out);
    }

    if (!glfwInit()) {
      throw new IllegalStateException("Unable to initialize GLFW");
    }

    setWindowHints();
    createWindow();
    createCallbacks();
    setupOpenGl();
  }

  @Override
  public boolean shouldClose() {
    return glfwWindowShouldClose(windowHandle) || shouldClose;
  }

  @Override
  public void swapBuffers() {
    glfwSwapBuffers(windowHandle);
  }

  @Override
  public void pollEvents() {
    glfwPollEvents();
  }

  private void setWindowHints() {
    glfwDefaultWindowHints();
    glfwWindowHint(GLFW_VISIBLE, GL_FALSE);
    glfwWindowHint(GLFW_RESIZABLE, GL_TRUE);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 4);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 1);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);
    glfwWindowHint(GLFW_OPENGL_DEBUG_CONTEXT, GLFW_TRUE);
  }

  private void createCallbacks() {
    glfwSetErrorCallback((error, description) -> log.error(String.format(
        "GLFW error [%s]: %s",
        Integer.toHexString(error),
        GLFWErrorCallback.getDescription(description))));

    glfwSetKeyCallback(windowHandle,
        (window, glfwKey, scancode, action, mods) -> {
          Optional<Key> key = keyCodeConverter.fromGlfwKey(glfwKey);

          if (key.isPresent()) {
            InputEvent event = null;

            if (action == GLFW_PRESS) {
              event = new KeyPressedEvent(key.get());
            } else if (action == GLFW_RELEASE) {
              event = new KeyReleasedEvent(key.get());
            }

            if (event != null) {
              eventBus.dispatch(event);
            }
          }
        });

    glfwSetFramebufferSizeCallback(windowHandle,
        (window, width, height) -> {
          var event = new WindowResizeEvent(new WindowSize(width, height));
          eventBus.dispatch(event);
        });

    glfwSetCursorPosCallback(windowHandle, (windowHandle, x, y) -> {
      // TODO fix casting?
      var event = new MouseMoveEvent(new MouseCoordinate((int) x, (int) y));
      eventBus.dispatch(event);
    });

    glfwSetMouseButtonCallback(windowHandle,
        (windowHandle, glfwButton, action, mode) -> {
          Optional<MouseButton> mouseButton = mouseCodeConverter.fromGlfwButton(glfwButton);

          if (mouseButton.isPresent()) {
            Event event = null;
            if (action == GLFW_PRESS) {
              event = new MouseButtonDownEvent(mouseButton.get(), mouseTracker.getMousePosition());
            } else if (action == GLFW_RELEASE) {
              event = new MouseButtonUpEvent(mouseButton.get(), mouseTracker.getMousePosition());
            }

            if (event != null) {
              eventBus.dispatch(event);
            }
          }
        });

    glfwSetCursorEnterCallback(windowHandle, (windowHandle, entered) -> {
      Event event;
      if (entered) {
        event = new MouseEnterEvent();
      } else {
        event = new MouseLeaveEvent();
      }
      eventBus.dispatch(event);
    });

    glfwSetScrollCallback(windowHandle, (windowHandle, xOffset, yOffset) ->
        eventBus.dispatch(new MouseScrollEvent((int) xOffset, (int) yOffset)));

    glfwSetWindowCloseCallback(windowHandle,
        (windowHandle) -> eventBus.dispatch(new CloseApplicationEvent()));
  }

  private void createWindow() {
    windowHandle = glfwCreateWindow(windowSettings.windowSize().width(),
        windowSettings.windowSize().height(),
        windowSettings.title(),
        NULL,
        NULL);
    if (windowHandle == NULL) {
      throw new RuntimeException("Failed to create the GLFW window");
    }

    GLFWVidMode vidmode = glfwGetVideoMode(glfwGetPrimaryMonitor());

    glfwSetWindowPos(windowHandle,
        (vidmode.width() - windowSettings.windowSize().width()) / 2,
        (vidmode.height() - windowSettings.windowSize().height()) / 2
    );

    glfwMakeContextCurrent(windowHandle);

    if (windowSettings.isVsyncEnabled()) {
      glfwSwapInterval(1);
    }

    glfwShowWindow(windowHandle);
  }

  private void setupOpenGl() {
    GL.createCapabilities();
  }

  public void cleanup() {
    Callbacks.glfwFreeCallbacks(windowHandle);
//    errorCallback.free();
    glfwDestroyWindow(windowHandle);
    glfwMakeContextCurrent(NULL);
    glfwTerminate();
  }
}
