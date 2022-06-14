package com.shepherdjerred.thermostat.core.thermometer;

import com.pi4j.wiringpi.Gpio;
import com.pi4j.wiringpi.GpioUtil;
import com.shepherdjerred.thermostat.core.Main;
import com.shepherdjerred.thermostat.core.redis.JedisManager;

/**
 * Based off of
 * http://stackoverflow.com/questions/28486159/read-temperature-from-dht11-using-pi4j/34976602#34976602
 */

public class DHT11 implements Thermometer {

    private static final int MAXTIMINGS = 85;
    private int pin;
    private long retryDelay;
    private float temp;
    private float humidity;
    private long lastPoll;
    private int[] dht11_dat = {0, 0, 0, 0, 0};

    public DHT11(int pin, long retryDelay) {
        temp = 600;
        this.pin = pin;
        this.retryDelay = retryDelay;
        enable();
    }

    public void enable() {
        GpioUtil.export(3, GpioUtil.DIRECTION_OUT);
    }

    public void updateTemp() {
        Main.getLogger().info("Updating temp");
        int laststate = Gpio.HIGH;
        int j = 0;
        dht11_dat[0] = dht11_dat[1] = dht11_dat[2] = dht11_dat[3] = dht11_dat[4] = 0;

        Gpio.pinMode(3, Gpio.OUTPUT);
        Gpio.digitalWrite(3, Gpio.LOW);
        Gpio.delay(18);

        Gpio.digitalWrite(3, Gpio.HIGH);
        Gpio.pinMode(3, Gpio.INPUT);

        for (int i = 0; i < MAXTIMINGS; i++) {
            int counter = 0;
            while (Gpio.digitalRead(3) == laststate) {
                counter++;
                Gpio.delayMicroseconds(1);
                if (counter == 255) {
                    break;
                }
            }

            laststate = Gpio.digitalRead(3);

            if (counter == 255) {
                break;
            }

      /* ignore first 3 transitions */
            if ((i >= 4) && (i % 2 == 0)) {
         /* shove each bit into the storage bytes */
                dht11_dat[j / 8] <<= 1;
                if (counter > 16) {
                    dht11_dat[j / 8] |= 1;
                }
                j++;
            }
        }
        // check we read 40 bits (8bit x 5 ) + verify checksum in the last
        // byte
        if ((j >= 40) && checkParity()) {
            float h = (float) ((dht11_dat[0] << 8) + dht11_dat[1]) / 10;
            if (h > 100) {
                h = dht11_dat[0];   // for DHT11
            }
            float c = (float) (((dht11_dat[2] & 0x7F) << 8) + dht11_dat[3]) / 10;
            if (c > 125) {
                c = dht11_dat[2];   // for DHT11
            }
            if ((dht11_dat[2] & 0x80) != 0) {
                c = -c;
            }
            float f = c * 1.8f + 32;
            Main.getLogger().info("Humidity = " + h + " Temperature = " + c + "(" + f + "f)");
            JedisManager.getJedisManager().updateStatus();
            temp = f;
            humidity = h;
        } else {
            Main.getLogger().info("Data not good, skip");
        }

    }

    public float getTemp() {
        return temp;
    }

    public float getHumidity() {
        return humidity;
    }

    public int getPin() {
        return pin;
    }

    public long getLastPoll() {
        return lastPoll;
    }

    public long getRetryDelay() {
        return retryDelay;
    }

    public void setRetryDelay(long retryDelay) {
        this.retryDelay = retryDelay;
    }

    private boolean checkParity() {
        return (dht11_dat[4] == ((dht11_dat[0] + dht11_dat[1] + dht11_dat[2] + dht11_dat[3]) & 0xFF));
    }
}
