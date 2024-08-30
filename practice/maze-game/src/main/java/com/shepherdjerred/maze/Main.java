package com.shepherdjerred.maze;

import java.io.Console;

public class Main {

    private static Console console;
    private static int consoleHeight;
    private static int consoleWidth;
    private static Game game;

    public static void main(String[] args) {

        for (int i = 0; i < 10000; i++) System.out.println();

        console = System.console();
        consoleHeight = jline.TerminalFactory.get().getHeight();
        consoleWidth = jline.TerminalFactory.get().getWidth();

        game = new Game();

        while (game.getStatus() == 0) {
            game.runGameLoop();
        }

        for (int i = 0; i < consoleHeight; i++) {
            System.out.println("");
        }

        // Print some ASCII art
        // Looks terrible in the IDE but it displays fine
        if (game.getStatus() == 1) {
            console.printf(" __     __          __          ___       _ \n" +
                    " \\ \\   / /          \\ \\        / (_)     | |\n" +
                    "  \\ \\_/ /__  _   _   \\ \\  /\\  / / _ _ __ | |\n" +
                    "   \\   / _ \\| | | |   \\ \\/  \\/ / | | '_ \\| |\n" +
                    "    | | (_) | |_| |    \\  /\\  /  | | | | |_|\n" +
                    "    |_|\\___/ \\__,_|     \\/  \\/   |_|_| |_(_)\n" +
                    "                                            \n" +
                    "                                            \n");
        } else {
            console.printf(" __     __           _                            __\n" +
                    " \\ \\   / /          | |                      _   / /\n" +
                    "  \\ \\_/ /__  _   _  | |     ___  ___  ___   (_) | | \n" +
                    "   \\   / _ \\| | | | | |    / _ \\/ __|/ _ \\      | | \n" +
                    "    | | (_) | |_| | | |___| (_) \\__ \\  __/   _  | | \n" +
                    "    |_|\\___/ \\__,_| |______\\___/|___/\\___|  (_) | | \n" +
                    "                                                 \\_\\\n" +
                    "                                                    ");
        }

        try {
            Thread.sleep(2000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            e.printStackTrace();
        }

        System.exit(1);

    }

    public static Console getConsole() {
        return console;
    }

    public static int getConsoleHeight() {
        return consoleHeight;
    }

    public static int getConsoleWidth() {
        return consoleWidth;
    }

    public static Game getGame() {
        return game;
    }
}
