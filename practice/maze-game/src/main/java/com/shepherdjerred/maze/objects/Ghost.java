package com.shepherdjerred.maze.objects;

import java.util.concurrent.ThreadLocalRandom;

public class Ghost extends MapObject {

    private long lastMove;
    private int moveFails;
    private int speed;
    private int smartness;

    public Ghost(int x, int y) {
        super(x, y, 'O');
        lastMove = 0;
        moveFails = 0;
        this.speed = ThreadLocalRandom.current().nextInt(150, 550 + 1);
        this.smartness = ThreadLocalRandom.current().nextInt(3, 7 + 1);
    }

    public long getLastMove() {
        return lastMove;
    }

    public void setLastMove(long lastMove) {
        this.lastMove = lastMove;
    }

    public int getMoveFails() {
        return moveFails;
    }

    public void setMoveFails(int moveFails) {
        this.moveFails = moveFails;
    }

    public int getSpeed() {
        return speed;
    }

    public int getSmartness() {
        return smartness;
    }
}
