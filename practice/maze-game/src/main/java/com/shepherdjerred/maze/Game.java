package com.shepherdjerred.maze;

import com.shepherdjerred.maze.objects.*;
import jline.console.ConsoleReader;
import org.apache.commons.lang3.text.WordUtils;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

public class Game {

    private int status = 0;
    private Player player;
    private int[] spawn = {1, 1};

    private List<String> gameLines;
    private List<MapObject> mapObjects;

    Game() {
        gameLines = new ArrayList<>();
        mapObjects = new ArrayList<>();
        initializeMap();
        player = new Player(spawn[0], spawn[1]);
        mapObjects.add(player);
        renderGame();
    }

    void generateMaze() {

        for (int y = 0; y < Main.getConsoleHeight(); y++) {
            for (int x = 0; x < Main.getConsoleWidth(); x++) {
                mapObjects.add(new Barrier(x, y));
            }
        }

        // Create a spawnpoint for the player
        spawn[0] = ThreadLocalRandom.current().nextInt(1, Main.getConsoleWidth());
        spawn[1] = ThreadLocalRandom.current().nextInt(1, Main.getConsoleHeight() - 2);

        List<MapObject> mapObjectsCopy = new ArrayList<>(mapObjects);

        for (MapObject mapObject : mapObjectsCopy) {
            if (mapObject.getX() == spawn[0] && mapObject.getY() == spawn[1])
                mapObjects.remove(mapObject);
        }

        int[] currentLocation = spawn;

        for (int i = 0; i < 8000; i++) {
            int randomX = currentLocation[0] + ThreadLocalRandom.current().nextInt(-1, 1);
            int randomY = currentLocation[1] + ThreadLocalRandom.current().nextInt(-1, 1);

            if (randomX != currentLocation[0] && randomY != currentLocation[1]) {
                double d = Math.random();

                if (d < 0.5) {
                    randomX = currentLocation[0];
                } else {
                    randomY = currentLocation[1];
                }
            }

            if (randomX < 0 || randomY < 0 || randomX > Main.getConsoleWidth() || randomY > Main.getConsoleHeight() - 2) {
                randomX = ThreadLocalRandom.current().nextInt(0, Main.getConsoleWidth());

                if (Math.random() < 0.5) {
                    randomY = ThreadLocalRandom.current().nextInt(0, Main.getConsoleHeight() - 2);
                } else {
                    randomY = ThreadLocalRandom.current().nextInt(20, Main.getConsoleHeight() - 2);
                }

            }

            for (MapObject mapObject : mapObjectsCopy) {
                if (mapObject.getX() == currentLocation[0] && mapObject.getY() == currentLocation[1])
                    mapObjects.remove(mapObject);
            }

            currentLocation[0] = randomX;
            currentLocation[1] = randomY;
        }

    }

    void generatePowerups() {

        for (int y = 0; y < Main.getConsoleHeight(); y++) {
            outerloop:
            for (int x = 0; x < Main.getConsoleWidth(); x++) {

                for (MapObject mapObject : mapObjects) {
                    if (mapObject.getX() == x && mapObject.getY() == y)
                        continue outerloop;
                }

                double d = Math.random();
                if (d < .075) {
                    mapObjects.add(new Powerup(x, y, '·', Powerup.Type.POINT, 5));
                } else if (d < .085) {
                    mapObjects.add(new Powerup(x, y, '#', Powerup.Type.EAT, 20));
                }
            }
        }

    }

    void spawnGhost() {

        int randX = 1;
        int randY = 1;
        boolean spawnSuccess = false;

        outerloop:
        while (!spawnSuccess) {
            randX = ThreadLocalRandom.current().nextInt(1, 10 + 1);
            randY = ThreadLocalRandom.current().nextInt(1, 10 + 1);
            for (MapObject mapObject : mapObjects) {
                if (mapObject.getX() == randX && mapObject.getY() == randY)
                    continue outerloop;
                else
                    spawnSuccess = true;
            }
        }

        mapObjects.add(new Ghost(randX, randY));

    }

    void createGhosts() {

        for (int i = 0; i < 4; i++)
            spawnGhost();

    }

    void initializeMap() {
        generateMaze();
        generatePowerups();
        createGhosts();

        for (int y = 0; y < Main.getConsoleHeight(); y++) {
            String line = "";
            for (int x = 0; x < Main.getConsoleWidth(); x++)
                line = line.concat(String.valueOf(' '));
            gameLines.add(line);
        }
    }

    void renderGame() {

        // Fill the map with blank characters
        // Do this first so the blanks don't ever overwrite other rendered characters
        for (int y = 0; y < Main.getConsoleHeight(); y++) {
            String line = "";
            for (int x = 0; x < Main.getConsoleWidth(); x++)
                line = line.concat(" ");
            gameLines.set(y, line);
        }

        // Add the map objects
        List<MapObject> mapObjectsCopy = new ArrayList<>(mapObjects);

        mapObjectsCopy.forEach(mapObject -> {
            StringBuilder objectLine = new StringBuilder(gameLines.get(mapObject.getY()));
            try {
                objectLine.setCharAt(mapObject.getX(), mapObject.getCharacter());
            } catch (StringIndexOutOfBoundsException e) {
                return;
            }
            gameLines.set(mapObject.getY(), objectLine.toString());
        });

        // Explicitly render the player
        // This ensures they're always on top
        StringBuilder objectLine = new StringBuilder(gameLines.get(player.getY()));
        objectLine.setCharAt(player.getX(), player.getCharacter());
        gameLines.set(player.getY(), objectLine.toString());

        // Output the lines to console
        gameLines.set(Main.getConsoleHeight() - 1, getScoreLine());

        StringBuilder builder = new StringBuilder();
        gameLines.forEach(builder::append);
        System.out.print(builder.toString() + '\r');

    }

    String getScoreLine() {
        int pointCount = 0;
        int ghostCount = 0;
        for (MapObject mapObject : mapObjects) {
            if (mapObject instanceof Powerup && ((Powerup) mapObject).getType() == Powerup.Type.POINT)
                pointCount++;
            else if (mapObject instanceof Ghost)
                ghostCount++;
        }

        String powerup = "None";
        if (player.getType() != null)
            powerup = WordUtils.capitalize(player.getType().toString());

        return " Score = " + player.getScore() + "      X: " + player.getX() + "   Y: " + player.getY() + "      Ghosts: " + ghostCount + "      Remaining Points: " + pointCount + "      Current Powerup: " + powerup;
    }

    void runGameLoop() {
        runGhostLogic();

        while (status == 0)
            listenForKeys();
    }

    void runGhostLogic() {
        new Thread() {
            public void run() {
                while (status == 0) {
                    List<MapObject> mapObjectsCopy = new ArrayList<>(mapObjects);

                    mapObjectsCopy.forEach(mapObject -> {
                        if (mapObject instanceof Ghost) {

                            Ghost ghost = (Ghost) mapObject;
                            if (System.currentTimeMillis() - ghost.getLastMove() > ghost.getSpeed()) {

                                int newY = mapObject.getY();
                                int newX = mapObject.getX();

                                if (ghost.getMoveFails() < ghost.getSmartness()) {
                                    if (player.getX() > ghost.getX())
                                        newX += 1;
                                    if (player.getY() > ghost.getY())
                                        newY += 1;
                                    if (player.getX() < ghost.getX())
                                        newX -= 1;
                                    if (player.getY() < ghost.getY())
                                        newY -= 1;
                                } else {
                                    double d = Math.random();
                                    if (d < 0.5) {
                                        newX += 1;
                                        newY += 1;
                                    } else {
                                        newX -= 1;
                                        newY -= 1;
                                    }
                                }

                                if (newX != mapObject.getX() && newY != mapObject.getY()) {
                                    double d = Math.random();

                                    // 50% chance of either the X or Y being changed
                                    // This ensures the ghosts never make two moves at once
                                    if (d < 0.5) {
                                        newX = ghost.getX();
                                    } else {
                                        newY = ghost.getY();
                                    }
                                }

                                if (moveIsValid(ghost, newX, newY)) {
                                    ghost.setMoveFails(ghost.getMoveFails() - 1);
                                    ghost.setLastMove(System.currentTimeMillis());
                                    mapObject.setX(newX);
                                    mapObject.setY(newY);
                                    checkGhostCollision();
                                    renderGame();
                                } else {
                                    ghost.setMoveFails(ghost.getMoveFails() + 1);
                                }

                            }
                        }
                    });
                }
            }
        }.start();
    }

    void checkGhostCollision() {

        Ghost ghost = null;

        for (MapObject mapObject : mapObjects) {
            if (mapObject instanceof Ghost && mapObject.getX() == player.getX() && mapObject.getY() == player.getY())
                ghost = (Ghost) mapObject;
        }

        if (ghost != null)
            if (player.getType() == Powerup.Type.EAT) {
                player.setType(null);
                mapObjects.remove(ghost);

                new Thread() {
                    public void run() {
                        try {
                            sleep(10000);
                            spawnGhost();
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                            e.printStackTrace();
                        }
                    }
                }.start();

            } else {
                status = 2;
            }

    }

    void listenForKeys() {

        ConsoleReader cr = null;

        try {
            cr = new ConsoleReader();
        } catch (IOException e) {
            e.printStackTrace();
        }

        if (cr.getInput() != null) {
            int read = 0;

            try {
                read = cr.readCharacter();
            } catch (IOException e) {
                e.printStackTrace();
            }

            if (System.currentTimeMillis() - player.getLastMove() < 25)
                return;

            int newX = player.getX();
            int newY = player.getY();

            if (read == 's')
                newY++;

            if (read == 'a')
                newX--;

            if (read == 'w')
                newY--;

            if (read == 'd')
                newX++;

            if (moveIsValid(player, newX, newY) && status == 0) {
                player.setLastMove(System.currentTimeMillis());
                player.setX(newX);
                player.setY(newY);
                checkGhostCollision();
                checkPowerupCollision();
                renderGame();
            }
        }
    }

    boolean moveIsValid(MapObject mapObject, int newX, int newY) {

        if (newX < 0 || newY < 0 || newX > Main.getConsoleWidth() - 1 || newY > Main.getConsoleHeight() - 2)
            return false;

        List<MapObject> mapObjectsCopy = new ArrayList<>(mapObjects);

        for (MapObject object : mapObjectsCopy) {
            if (object instanceof Powerup || object instanceof Player)
                continue;
            if (newX == object.getX() && newY == object.getY()) {
                if (mapObject instanceof Ghost && object instanceof Ghost)
                    return false;
                else if (object instanceof Ghost)
                    return true;
                return false;
            }
        }

        return true;

    }

    void checkPowerupCollision() {

        Powerup powerup = null;

        for (MapObject mapObject : mapObjects) {
            if (mapObject instanceof Powerup && mapObject.getX() == player.getX() && mapObject.getY() == player.getY())
                powerup = (Powerup) mapObject;
        }

        if (powerup != null) {
            if (powerup.getType() != Powerup.Type.POINT && player.getType() != null)
                return;
            mapObjects.remove(powerup);
            player.runPowerup(powerup);
        }

    }

    public int getStatus() {
        return status;
    }
}
