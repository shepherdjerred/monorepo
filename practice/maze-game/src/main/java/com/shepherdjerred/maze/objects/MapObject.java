package com.shepherdjerred.maze.objects;

public abstract class MapObject {

    private int x;
    private int y;
    private char character;

    MapObject(int x, int y, char character) {
        this.x = x;
        this.y = y;
        this.character = character;
    }

    public int getX() {
        return x;
    }

    public int getY() {
        return y;
    }

    public void increaseX() {
        x++;
    }

    public void increaseY() {
        y++;
    }

    public void decreaseX() {
        x--;
    }

    public void decreaseY() {
        y--;
    }

    public void setX(int x) {
        this.x = x;
    }

    public void setY(int y) {
        this.y = y;
    }

    public char getCharacter() {
        return character;
    }
}
