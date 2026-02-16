---
title: "Binary Watch"
date: 2024-07-28Z-0700
leetcode: true
---

## Problem

A binary watch has 4 LEDs on the top to represent the hours (0-11), and 6 LEDs on the bottom to represent the minutes (0-59). Each LED represents a zero or one, with the least significant bit on the right.

- For example, the below binary watch reads "4:51".

Given an integer turnedOn which represents the number of LEDs that are currently on (ignoring the PM), return all possible times the watch could represent. You may return the answer in any order.

The hour must not contain a leading zero.

- For example, "01:00" is not valid. It should be "1:00".

The minute must consist of two digits and may contain a leading zero.

- For example, "10:2" is not valid. It should be "10:02".

Example 1:

```text
Input: turnedOn = 1
Output: ["0:01","0:02","0:04","0:08","0:16","0:32","1:00","2:00","4:00","8:00"]
```

Example 2:

```text
Input: turnedOn = 9
Output: []
```

Constraints:

- 0 <= turnedOn <= 10

## Solution

```java
class Solution {
    public List<String> readBinaryWatch(int turnedOn) {
        var answer = new ArrayList<String>();
        solve(turnedOn, 0, new BitSet(10), answer);
        return answer;
    }

    public String bString(BitSet b) {
        return String.format("%d:%02d", hours(b), minutes(b));
    }

    public int hours(BitSet b) {
        // skip the first 6 bits
        int mul = 1;
        int value = 0;
        for (var i = 6; i < 10; i++) {
            value = value + (mul * (b.get(i) ? 1 : 0));
            mul = mul << 1;
        }
        return value;
    }

    public int minutes(BitSet b) {
        // read the first 6 bits
        var mul = 1;
        var value = 0;
        for (var i = 0; i < 6; i++) {
            value = value + (mul * (b.get(i) ? 1 : 0));
            mul = mul << 1;
        }
        return value;
    }

    public void solve(int turnedOn, int start, BitSet b, List<String> answer) {
        if (turnedOn == 0) {
            answer.add(bString(b));
            return;
        }

        for (int i = start; i < 10; i++) {
            if (b.get(i) == true) {
                continue;
            }
            BitSet copy = (BitSet) b.clone();
            copy.set(i);
            // validate
            if (hours(copy) > 11 || minutes(copy) >= 60) {
                continue;
            }
            solve(turnedOn - 1, i, copy, answer);
        }
    }
}
```
