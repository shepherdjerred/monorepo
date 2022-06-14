package com.shepherdjerred.thermostat.core;

import com.shepherdjerred.thermostat.core.cli.Cli;
import com.shepherdjerred.thermostat.core.pi.GpioWrapper;
import com.shepherdjerred.thermostat.core.redis.JedisManager;
import com.shepherdjerred.thermostat.core.scheduling.Scheduler;
import com.shepherdjerred.thermostat.core.thermometer.DHT11;
import com.shepherdjerred.thermostat.core.theromostat.LR27935;

import java.io.IOException;
import java.util.logging.FileHandler;
import java.util.logging.Logger;
import java.util.logging.SimpleFormatter;

public class Main {

    private static GpioWrapper gpioWrapper;
    private static Controller controller;
    private static Logger logger = Logger.getLogger("log");
    private static FileHandler fh;

    public static void main(String[] args) {
        System.out.println("thermostat-core starting...");
        new JedisManager();
        setupCli();
        setupLogging();
        init();
        System.out.println("Loading complete!");
    }

    private static void setupCli() {
        new Thread() {
            @Override
            public void run() {
                while (true) {

                    String[] input = System.console().readLine().split(" ");

                    if (input.length < 0)
                        return;

                    if (input.length > 2) {
                        System.out.println("Too many arguments");
                        return;
                    }

                    String cmd = input[0];
                    String arg = null;

                    if (input.length > 1) {
                        arg = input[1];
                    }

                    new Cli().parse(cmd, arg);

                }
            }
        }.start();
    }

    private static void init() {
        gpioWrapper = new GpioWrapper();
        controller = new Controller(new LR27935(), new DHT11(3, 500), new Scheduler(70));
    }

    public static void stop() {
        System.exit(0);
    }

    private static void setupLogging() {
        try {
            System.out.println("Saving log to output.log");
            fh = new FileHandler("output.log");
            logger.setUseParentHandlers(false);
            logger.addHandler(fh);
            SimpleFormatter formatter = new SimpleFormatter();
            fh.setFormatter(formatter);
        } catch (SecurityException | IOException e) {
            e.printStackTrace();
        }
    }

    public static Controller getController() {
        return controller;
    }

    public static GpioWrapper getGpioWrapper() {
        return gpioWrapper;
    }

    public static Logger getLogger() {
        return logger;
    }
}
