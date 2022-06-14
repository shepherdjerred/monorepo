package com.shepherdjerred.thermostat.core.scheduling;

import java.util.Calendar;

public class Entry {

    private Calendar startTime;
    private Calendar endTime;
    private int targetTemp;

    public Entry(Calendar startTime, Calendar endTime, int targetTemp) {
        this.startTime = startTime;
        this.endTime = endTime;
        this.targetTemp = targetTemp;
    }

    public Calendar getStartTime() {
        return startTime;
    }

    public Calendar getEndTime() {
        return endTime;
    }

    public int getTargetTemp() {
        return targetTemp;
    }
}
