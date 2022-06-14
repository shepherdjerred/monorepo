package com.shepherdjerred.thermostat.core.thermometer;

public interface Thermometer {

    void enable();
    void updateTemp();
    float getTemp();
    float getHumidity();
    long getLastPoll();
    int getPin();
    long getRetryDelay();
    void setRetryDelay(long retryDelay);

}
