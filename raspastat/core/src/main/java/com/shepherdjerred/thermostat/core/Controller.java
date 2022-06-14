package com.shepherdjerred.thermostat.core;

import com.shepherdjerred.thermostat.core.redis.JedisManager;
import com.shepherdjerred.thermostat.core.scheduling.Scheduler;
import com.shepherdjerred.thermostat.core.thermometer.Thermometer;
import com.shepherdjerred.thermostat.core.theromostat.Thermostat;

public class Controller {

    private boolean enabled;
    private int tolerance;
    private long updatePeriod;
    private float targetTemp;
    private Thermostat thermostat;
    private Thermometer thermometer;
    private Scheduler scheduler;

    public Controller(Thermostat thermostat, Thermometer thermometer, Scheduler scheduler) {
        this.thermostat = thermostat;
        this.thermometer = thermometer;
        this.scheduler = scheduler;
        targetTemp = scheduler.getDefaultTemp();
        this.tolerance = 2;
        this.updatePeriod = 1500;
        setEnabled(true);
    }

    private void runTempLoop() {
        new Thread() {
            public void run() {
                while (enabled) {

                    thermometer.updateTemp();

                    if (thermometer.getTemp() != 600 && Math.abs((thermometer.getTemp() - targetTemp)) > tolerance && thermometer.getTemp() != targetTemp) {
                        if (thermometer.getTemp() > targetTemp) {
                            // It's too hot
                            if (thermostat.getMode() != Thermostat.Mode.COOL)
                                thermostat.setMode(Thermostat.Mode.COOL);
                        } else {
                            // It's too cold
                            if (thermostat.getMode() != Thermostat.Mode.HEAT)
                                thermostat.setMode(Thermostat.Mode.HEAT);
                        }
                        try {
                            Thread.sleep(updatePeriod);
                        } catch (InterruptedException e) {
                            e.printStackTrace();
                        }
                    } else {
                        // The temperature is fine for now, turn it off, and check back after some time
                        if (thermostat.getMode() != Thermostat.Mode.OFF)
                            thermostat.setMode(Thermostat.Mode.OFF);
                        try {
                            // We'll wait 3 minutes after turning off before turning on again.
                            Thread.sleep(180000);
                        } catch (InterruptedException e) {
                            e.printStackTrace();
                        }

                    }
                }
            }
        }.start();
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
        JedisManager.getJedisManager().updateStatus();
        if (enabled)
            runTempLoop();
    }

    public int getTolerance() {
        return tolerance;
    }

    public void setTolerance(int tolerance) {
        this.tolerance = tolerance;
        JedisManager.getJedisManager().updateStatus();
    }

    public long getUpdatePeriod() {
        return updatePeriod;
    }

    public void setUpdatePeriod(long updatePeriod) {
        this.updatePeriod = updatePeriod;
        JedisManager.getJedisManager().updateStatus();
    }

    public float getTargetTemp() {
        return targetTemp;
    }

    public void setTargetTemp(float targetTemp) {
        this.targetTemp = targetTemp;
        JedisManager.getJedisManager().updateStatus();
    }

    public Thermostat getThermostat() {
        return thermostat;
    }

    public Thermometer getThermometer() {
        return thermometer;
    }

    public Scheduler getScheduler() {
        return scheduler;
    }
}
