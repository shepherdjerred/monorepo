package com.shepherdjerred.maze.objects;

public class Powerup extends MapObject {

    private Type type;
    private int modifier;

    public Powerup(int x, int y, char character, Type type, int modifier) {
        super(x, y, character);
        this.type = type;
        this.modifier = modifier;
    }

    public Type getType() {
        return type;
    }

    public int getModifier() {
        return modifier;
    }

    public enum Type {
        POINT, EAT
    }

}
