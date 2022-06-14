package com.shepherdjerred.thermostat.core.theromostat;

import com.pi4j.wiringpi.Gpio;
import com.pi4j.wiringpi.GpioUtil;
import com.shepherdjerred.thermostat.core.Main;
import com.shepherdjerred.thermostat.core.redis.JedisManager;

/*
 Thermostat implementation for the White-Rodgers LR27935 thermostat
 Used in the Cone dorm at Harding University
 */

public class LR27935 implements Thermostat {

    private Mode mode;

    public LR27935() {
        mode = Mode.OFF;
    }

    public Mode getMode() {
        return mode;
    }

    public void setMode(Mode mode) {
        Main.getLogger().info("\n\n" + "Mode changed to " + mode.toString() + "\n");
        this.mode = mode;
        JedisManager.getJedisManager().updateStatus();
        updateThermostatSettings();
    }

    // We do the physical stuff here, signaling the AC
    /*
    Pin 3 = Thermometer
    Pin 4 = Green
    Pin 5 = Yellow
    Pin 27 = Orange
     */
    public void updateThermostatSettings() {
        switch (mode) {
            case COOL:
                // G needs to be high
                GpioUtil.export(4, GpioUtil.DIRECTION_OUT);
                Gpio.pinMode(4, Gpio.OUTPUT);
                Gpio.digitalWrite(4, Gpio.LOW);
                // Y needs to be high
                GpioUtil.export(5, GpioUtil.DIRECTION_OUT);
                Gpio.pinMode(5, Gpio.OUTPUT);
                Gpio.digitalWrite(5, Gpio.LOW);
                // O needs to be high
                GpioUtil.export(27, GpioUtil.DIRECTION_OUT);
                Gpio.pinMode(27, Gpio.OUTPUT);
                Gpio.digitalWrite(27, Gpio.LOW);
                break;
            case HEAT:
                // G needs to be high
                GpioUtil.export(4, GpioUtil.DIRECTION_OUT);
                Gpio.pinMode(4, Gpio.OUTPUT);
                Gpio.digitalWrite(4, Gpio.LOW);
                // Y needs to be high
                GpioUtil.export(5, GpioUtil.DIRECTION_OUT);
                Gpio.pinMode(5, Gpio.OUTPUT);
                Gpio.digitalWrite(5, Gpio.LOW);
                // O needs to be low
                GpioUtil.export(27, GpioUtil.DIRECTION_OUT);
                Gpio.pinMode(27, Gpio.OUTPUT);
                Gpio.digitalWrite(27, Gpio.HIGH);
                break;
            case OFF:
                // G needs to be low
                GpioUtil.export(4, GpioUtil.DIRECTION_OUT);
                Gpio.pinMode(4, Gpio.OUTPUT);
                Gpio.digitalWrite(4, Gpio.HIGH);
                // Y needs to be low
                GpioUtil.export(5, GpioUtil.DIRECTION_OUT);
                Gpio.pinMode(5, Gpio.OUTPUT);
                Gpio.digitalWrite(5, Gpio.HIGH);
                // O needs to be low
                GpioUtil.export(27, GpioUtil.DIRECTION_OUT);
                Gpio.pinMode(27, Gpio.OUTPUT);
                Gpio.digitalWrite(27, Gpio.HIGH);
        }
    }

}
