---
title: "Longest Word in Dictionary"
date: 2024-08-11Z-0700
leetcode: true
---

## Problem

Given an array of strings words representing an English Dictionary, return the longest word in words that can be built one character at a time by other words in words.

If there is more than one possible answer, return the longest word with the smallest lexicographical order. If there is no answer, return the empty string.

Note that the word should be built from left to right with each additional character being added to the end of a previous word.

Example 1:

```text
Input: words = ["w","wo","wor","worl","world"]
Output: "world"
Explanation: The word "world" can be built one character at a time by "w", "wo", "wor", and "worl".
```

Example 2:

```text
Input: words = ["a","banana","app","appl","ap","apply","apple"]
Output: "apple"
Explanation: Both "apply" and "apple" can be built from other words in the dictionary. However, "apple" is lexicographically smaller than "apply".
```

Constraints:

- 1 <= words.length <= 1000
- 1 <= words[i].length <= 30
- words[i] consists of lowercase English letters.

## Solution

Time: O(n \* (log n) + n \* k)

```java
class Solution {
    record Node(Character c, Map<Character, Node> next) {
    }

    Node head = new Node(null, new HashMap<Character, Node>());

    public String longestWord(String[] words) {
        Arrays.sort(words);
        var longest = "";
        for (var w : words) {
            if (insert(head, w, 0)) {
                if (w.length() > longest.length()) {
                    longest = w;
                }
            }
        }
        return longest;
    }

    boolean insert(Node n, String s, int idx) {
        var c = s.charAt(idx);
        if (idx == s.length() - 1) {
            if (!n.next.containsKey(c)) {
                var newN = new Node(c, new HashMap<>());
                n.next.put(c, newN);
            }

            return true;
        }

        if (n.next.containsKey(c)) {
            return insert(n.next.get(c), s, idx + 1);
        } else {
            return false;
        }
    }
}
```
