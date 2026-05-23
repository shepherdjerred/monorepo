module com.shepherdjerred.castlecasters {
  requires static lombok;
  requires org.lwjgl.glfw;
  requires org.lwjgl.opengl;
  requires org.joml;
  requires org.lwjgl.stb;
  requires com.google.common;
  requires org.lwjgl.openal;
  requires name.machine;
  requires ai.algorithms;
  requires io.jenetics.base;
  requires gson.extras;
  requires io.netty.transport;
  requires io.netty.codec;
  requires io.netty.handler;
  requires io.netty.common;
  requires com.google.gson;
  requires io.netty.buffer;
  //noinspection Java9RedundantRequiresStatement
  requires org.apache.logging.log4j;

  opens com.shepherdjerred.castlecasters.logic.match to com.google.gson;
  opens com.shepherdjerred.castlecasters.logic.board to com.google.gson;
  opens com.shepherdjerred.castlecasters.logic.board.layout to com.google.gson;
  opens com.shepherdjerred.castlecasters.logic.board.pieces to com.google.gson;
  opens com.shepherdjerred.castlecasters.logic.player to com.google.gson;
  opens com.shepherdjerred.castlecasters.logic.turn.enactor to com.google.gson;
  opens com.shepherdjerred.castlecasters.logic.turn.validator to com.google.gson;
  opens com.shepherdjerred.castlecasters.logic.piece to com.google.gson;
}
