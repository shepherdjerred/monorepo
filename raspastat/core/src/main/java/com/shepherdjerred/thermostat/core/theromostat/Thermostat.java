package com.shepherdjerred.thermostat.core.theromostat;

public interface Thermostat {

    void setMode(Mode mode);
    Mode getMode();
    void updateThermostatSettings();

    enum Mode {
        OFF, HEAT, COOL
    }

}
