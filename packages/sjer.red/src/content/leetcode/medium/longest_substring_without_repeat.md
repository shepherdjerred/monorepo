---
title: "Longest Substring Without Repeating Characters"
date: 2024-08-09Z-0700
leetcode: true
---

Given a string s, find the length of the longest substring without repeating characters.

Example 1:

```text
Input: s = "abcabcbb"
Output: 3
Explanation: The answer is "abc", with the length of 3.
```

Example 2:

```text
Input: s = "bbbbb"
Output: 1
Explanation: The answer is "b", with the length of 1.
```

Example 3:

```text
Input: s = "pwwkew"
Output: 3
Explanation: The answer is "wke", with the length of 3.
Notice that the answer must be a substring, "pwke" is a subsequence and not a substring.
```

Constraints:

- 0 <= s.length <= 5 \* 104
- s consists of English letters, digits, symbols and spaces.

## Solution

### Another Sliding Window

This one makes perfect sense!

```java
class Solution {
    public int lengthOfLongestSubstring(String s) {
        var max = 0;
        var freq = new int[128];
        var l = 0;
        var r = 0;

        while (r < s.length()) {
            var c = s.charAt(r);
            freq[c] += 1;

            while (freq[c] > 1) {
                var c2 = s.charAt(l);
                freq[c2] -= 1;
                l += 1;
            }

            max = Math.max(max, r - l + 1);

            r += 1;
        }

        return max;
    }
}
```

### Sliding Window

I don't really understand this one.

```java
class Solution {
    public int lengthOfLongestSubstring(String s) {
        var l = 0;
        var m = new HashMap<Character, Integer>();
        var answer = 0;
        for (var r = 0; r < s.length(); r++) {
            var c = s.charAt(r);
            if (m.containsKey(c)) {
                l = Math.max(m.get(c), l);
            }
            m.put(c, r + 1);
            answer = Math.max(r - l + 1, answer);
        }
        return answer;
    }
}
```

### Another Unoptimized

```java
class Solution {
    public int lengthOfLongestSubstring(String s) {
        // brute force
        var max = 0;
        for (var l = 0; l < s.length(); l++) {
            for (var r = l; r < s.length(); r++) {
                var freq = new boolean[128];
                var ok = true;
                // check if this string is valid
                for (var i = l; i <= r; i++) {
                    var c = (int) s.charAt(i);
                    if (freq[c]) {
                        ok = false;
                        break;
                    }
                    freq[c] = true;
                }
                if (ok) {
                    max = Math.max(max, r - l + 1);
                }
            }
        }
        return max;
    }
}
```

### Unoptimized

I think this solution is correct, but it hits a time limit exceeded error

```java
class Solution {
    public int lengthOfLongestSubstring(String s) {
        var size = s.length();

        while (size > 0) {
            for (var l = 0; l <= s.length() - size; l++) {
                var r = l + size;
                // check if any of the letters in this range are duplicated
                var set = new HashSet<Character>();
                var ok = true;
                for (var c : s.substring(l, r).toCharArray()) {
                    if (set.contains(c)) {
                        ok = false;
                        break;
                    } else {
                        set.add(c);
                    }
                }
                if (ok) {
                    return size;
                }
            }
            size -= 1;
        }

        return size;
    }
}
```
