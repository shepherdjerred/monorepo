package com.shepherdjerred.thermostat.core.scheduling;

import com.shepherdjerred.thermostat.core.Main;

import java.util.LinkedList;

public class Scheduler {

    private int defaultTemp;
    private LinkedList<Entry> entries = new LinkedList<>();
    private long nextEntry;

    public Scheduler(int defaultTemp) {
        this.defaultTemp = defaultTemp;
        loadEntries();
        Main.getLogger().info("Default temp is " + defaultTemp);
    }

    public int getDefaultTemp() {
        return defaultTemp;
    }

    public void setDefaultTemp(int defaultTemp) {
        this.defaultTemp = defaultTemp;
    }

    public LinkedList<Entry> getEntries() {
        return entries;
    }

    public long getNextEntry() {
        return nextEntry;
    }

    public void loadEntries() {

    }
}
