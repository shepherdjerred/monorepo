package com.shepherdjerred.thermostat.core.api;

import com.shepherdjerred.thermostat.core.Main;
import com.shepherdjerred.thermostat.core.auth.User;

public class Api {

    // TODO Log the users action
    public static void setTemperature(User user, int temp) {
        Main.getController().setTargetTemp(temp);
    }

    public static void setTolerance(User user, int tolerance) {
        Main.getController().setTolerance(tolerance);
    }

    public static void setPeriod(User user, int period) {
        Main.getController().setUpdatePeriod(period);
    }

    public static void setEnabled(User user, boolean enabled) {
        Main.getController().setEnabled(enabled);
    }

}