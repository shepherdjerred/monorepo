package com.shepherdjerred.castlecasters.engine.input.keyboard;

import java.util.Optional;

import static com.shepherdjerred.castlecasters.engine.input.keyboard.Key.*;
import static org.lwjgl.glfw.GLFW.*;

/**
 * Converts GLFW integer keycodes to a Key enum.
 */
public class GlfwKeyCodeConverter {

  public Optional<Key> fromGlfwKey(int glfwKey) {
    Key key = switch (glfwKey) {
      case GLFW_KEY_A -> A;
      case GLFW_KEY_B -> B;
      case GLFW_KEY_C -> C;
      case GLFW_KEY_D -> D;
      case GLFW_KEY_E -> E;
      case GLFW_KEY_F -> F;
      case GLFW_KEY_G -> G;
      case GLFW_KEY_H -> H;
      case GLFW_KEY_I -> I;
      case GLFW_KEY_J -> J;
      case GLFW_KEY_K -> K;
      case GLFW_KEY_L -> L;
      case GLFW_KEY_M -> M;
      case GLFW_KEY_N -> N;
      case GLFW_KEY_O -> O;
      case GLFW_KEY_P -> P;
      case GLFW_KEY_Q -> Q;
      case GLFW_KEY_R -> R;
      case GLFW_KEY_S -> S;
      case GLFW_KEY_T -> T;
      case GLFW_KEY_U -> U;
      case GLFW_KEY_V -> V;
      case GLFW_KEY_W -> W;
      case GLFW_KEY_X -> X;
      case GLFW_KEY_Y -> Y;
      case GLFW_KEY_Z -> Z;
      case GLFW_KEY_SPACE -> SPACE;
      case GLFW_KEY_1 -> ONE;
      case GLFW_KEY_2 -> TWO;
      case GLFW_KEY_3 -> THREE;
      case GLFW_KEY_4 -> FOUR;
      case GLFW_KEY_5 -> FIVE;
      case GLFW_KEY_6 -> SIX;
      case GLFW_KEY_7 -> SEVEN;
      case GLFW_KEY_8 -> EIGHT;
      case GLFW_KEY_9 -> NINE;
      case GLFW_KEY_0 -> ZERO;
      case GLFW_KEY_UP -> UP;
      case GLFW_KEY_DOWN -> DOWN;
      case GLFW_KEY_LEFT -> LEFT;
      case GLFW_KEY_RIGHT -> RIGHT;
      case GLFW_KEY_ESCAPE -> ESCAPE;
      default -> null;
    };

    if (key == null) {
      return Optional.empty();
    } else {
      return Optional.of(key);
    }
  }
}
