---
title: "First Unique Character in a String"
date: 2024-06-15Z-0700
leetcode: true
---

## Problem

Given a string s, find the first non-repeating character in it and return its index. If it does not exist, return -1.

Example 1:

```text
Input: s = "leetcode"
Output: 0
```

Example 2:

```text
Input: s = "loveleetcode"
Output: 2
```

Example 3:

```text
Input: s = "aabb"
Output: -1
```

Constraints:

- 1 <= s.length <= 10^5
- s consists of only lowercase English letters.

## Solution

This was my original solution. It's too slow with the use of a TreeMap. Obviously we can do better.

```java
class Solution {
    public int firstUniqChar(String s) {
        var count = new HashMap<Character, Integer>();
        var index = new TreeMap<Character, Integer>();
        for (var i = 0; i < s.length(); i++) {
            var c = s.charAt(i);
            count.compute(c, (key, value) -> value == null ? 1 : value + 1);
            index.putIfAbsent(c, i);
        }

        for (var entry : index.entrySet()) {
            var key = entry.getKey();
            var value = entry.getValue();
            if (value == 1) {
                return index.get(key);
            }
        }

        return -1;
    }
}
```

Another use for my ASCII drink coaster.

Improved solution, O(n) time, O(1) space.

```java
class Solution {
    public int firstUniqChar(String s) {
        var abc = new int[26];
        for (int i = 0; i < s.length(); i++) {
            var c = ((int) s.charAt(i)) - 97;
            abc[c] += 1;
        }

        // now that we have a freq map, we can just iterate
        for (int i = 0; i < s.length(); i++) {
            var c = ((int) s.charAt(i)) - 97;
            var reps = abc[c];
            if (reps == 1) {
                return i;
            }
        }

        return -1;
    }
}
```
