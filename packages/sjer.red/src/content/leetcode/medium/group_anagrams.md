---
title: "Group Anagrams"
date: 2024-08-01Z-0700
leetcode: true
---

## Problem

Given an array of strings strs, group the anagrams together. You can return the answer in any order.

An Anagram is a word or phrase formed by rearranging the letters of a different word or phrase, typically using all the original letters exactly once.

Example 1:

```text
Input: strs = ["eat","tea","tan","ate","nat","bat"]
Output: [["bat"],["nat","tan"],["ate","eat","tea"]]
```

Example 2:

```text
Input: strs = [""]
Output: [[""]]
```

Example 3:

```text
Input: strs = ["a"]
Output: [["a"]]
```

Constraints:

- 1 <= strs.length <= 104
- 0 <= strs[i].length <= 100
- strs[i] consists of lowercase English letters.

## Solution

First try!

```java
class Solution {
    public List<List<String>> groupAnagrams(String[] strs) {
        var output = new ArrayList<List<String>>();
        int[][] a = new int[strs.length][26];
        Map<String, List<String>> m = new HashMap<>();

        for (int i = 0; i < strs.length; i++) {
            var str = strs[i];
            for (var c : str.toCharArray()) {
                a[i][(int) c - 'a'] += 1;
            }
            var key = Arrays.toString(a[i]);
            if (m.containsKey(key)) {
                m.get(key).add(str);
            } else {
                var l = new ArrayList<String>();
                l.add(str);
                m.put(key, l);
                output.add(l);
            }
        }

        return output;
    }
}
```

### Cleaned up

Here's the above solution, just cleaned up a bit

```java
class Solution {
    public List<List<String>> groupAnagrams(String[] strs) {
        var a = new int[26];
        var m = new HashMap<String, List<String>>();

        for (var str : strs) {
            Arrays.fill(a, 0);
            for (var c : str.toCharArray()) {
                a[(int) c - 'a'] += 1;
            }
            var key = Arrays.toString(a);
            m.compute(key, (k, v) -> {
                if (v == null) {
                    v = new ArrayList<String>();
                }
                v.add(str);
                return v;
            });
        }

        return new ArrayList<>(m.values());
    }
}
```
