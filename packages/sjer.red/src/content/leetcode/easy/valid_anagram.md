---
title: "Valid Anagram"
date: 2024-06-15Z-0700
leetcode: true
---

## Problem

Given two strings s and t, return true if t is an anagram of s, and false otherwise.

An Anagram is a word or phrase formed by rearranging the letters of a different word or phrase, typically using all the original letters exactly once.

Example 1:

```text
Input: s = "anagram", t = "nagaram"
Output: true
```

Example 2:

```text
Input: s = "rat", t = "car"
Output: false
```

Constraints:

- 1 <= s.length, t.length <= 5 \* 10^4
- s and t consist of lowercase English letters.

Follow up: What if the inputs contain Unicode characters? How would you adapt your solution to such a case?

## Solution

This will have a similar solution to [First Unique](./first_unique.md).

We can count the characters in each and see if they are equal.

For the follow up question, we could swap the arrays with a `Map<Character, Integer>`. We'd iterate over the contents of both strings and calculate how many times each Unicode character is used.

We'd then iterate over the contents of both maps and ensure they are equal. This would be O(1) insertion, O(1) lookup with a HashMap, meaning the algorithm overall would still be O(n) time, though the space would increase from O(1) to O(n).

```java
class Solution {
    public boolean isAnagram(String s, String t) {
        var l = new int[26];
        var r = new int[26];

        for (var c : s.toCharArray()) {
            l[((int) c) - 97] += 1;
        }

        for (var c : t.toCharArray()) {
            r[((int) c) - 97] += 1;
        }

        for (int i = 0; i < 26; i++) {
            if (l[i] == r[i]) {
                continue;
            }
            return false;
        }

        return true;
    }
}
```
