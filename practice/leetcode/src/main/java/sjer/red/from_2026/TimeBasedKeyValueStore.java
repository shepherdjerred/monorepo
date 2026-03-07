package sjer.red.from_2026;

import sjer.red.from_2024.Balance;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class TimeBasedKeyValueStore {
    // initial thought:
    // Entry = { time: DateTime, value: String }
    // Map<String, List<Entry>>
    // O(n + m) lookup
    // where n = num of keys
    // and m = num of values
    //
    // talked to claude. a few things to clarify
    // hashmap is O(1), idk how I forgot that
    // lookup could be reduce to log(m) with binary search
    Map<String, List<Entry>> map = new HashMap<>();

    record Entry(String value, int timestamp) {
    }

    public void set(String key, String value, int timestamp) {
        var val = map.getOrDefault(key, new ArrayList<>());
        val.add(new Entry(value, timestamp));
        map.put(key, val);
    }

    public String get(String key, int timestamp) {
        return getBinary(key, timestamp);
    }

    // we are going to implement our own custom binary search
    // basic idea: search through the entries. keep track of the last valid value.
    public String getBinary(String key, int timestamp) {
        var list = map.get(key);
        if (list == null) {
            return "";
        }
        var left = 0;
        var right = list.size() - 1;
        String lastValidValue = "";
        while (left <= right) {
            var offset = left;
            var size = right - left;
            int middle = offset + (size / 2);

//            System.out.printf("%s, L %s, R %s, LVV %s, O %s, S %s, M %s%n", list, left, right, lastValidValue, offset, size, middle);

            if (list.get(middle).timestamp > timestamp) {
                // too big!
                right = middle - 1;
            } else if (list.get(middle).timestamp < timestamp) {
                // too small!
                // but, this is still a valid middle so let's take it just in case
                lastValidValue = list.get(middle).value;
                left = middle + 1;
            } else {
                // perfect match!
                return list.get(middle).value;
            }
        }
        return lastValidValue;
    }

    public String getLinear(String key, int timestamp) {
        var list = map.get(key);
        String last = "";
        for (Entry entry : list) {
            if (entry.timestamp <= timestamp) {
                last = entry.value;
            } else {
                break;
            }
        }
        return last;
    }

    // assumptions: don't have to deal with nulls
    // there will always be a valid return value
    public static void main(String[] args) {
        var store = new TimeBasedKeyValueStore();
        store.set("test", "hi", 1);
        store.set("test", "there", 4);

        System.out.println(store.get("test", 4)); // there
        System.out.println(store.get("test", 5)); // there

        System.out.println("ok");
    }
}
