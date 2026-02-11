package com.shepherdjerred.castlecasters.engine;

import lombok.Getter;

@Getter
public class Timer {

  private double lastLoopTime;

  public Timer() {
    lastLoopTime = getTime();
  }

  public double getTime() {
    return System.nanoTime() / 1000_000_000.0;
  }

  public float getElapsedTime() {
    double time = getTime();
    float elapsedTime = (float) (time - lastLoopTime);
    lastLoopTime = time;
    return elapsedTime;
  }

}
