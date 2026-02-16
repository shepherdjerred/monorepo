---
title: "String to Integer (atoi)"
date: 2024-06-15Z-0700
leetcode: true
---

## Problem

Implement the myAtoi(string s) function, which converts a string to a 32-bit signed integer.

The algorithm for myAtoi(string s) is as follows:

Whitespace: Ignore any leading whitespace (" ").
Signedness: Determine the sign by checking if the next character is '-' or '+', assuming positivity is neither present.
Conversion: Read the integer by skipping leading zeros until a non-digit character is encountered or the end of the string is reached. If no digits were read, then the result is 0.
Rounding: If the integer is out of the 32-bit signed integer range [-2^31, 2^31 - 1], then round the integer to remain in the range. Specifically, integers less than -2^31 should be rounded to -2^31, and integers greater than 2^31 - 1 should be rounded to 2^31 - 1.
Return the integer as the final result.

Example 1:

```text
Input: s = "42"
Output: 42
Explanation:
The underlined characters are what is read in and the caret is the current reader position.
Step 1: "42" (no characters read because there is no leading whitespace)
         ^
Step 2: "42" (no characters read because there is neither a '-' nor '+')
         ^
Step 3: "42" ("42" is read in)
           ^
```

Example 2:

```text
Input: s = " -042"
Output: -42
Explanation:
Step 1: "   -042" (leading whitespace is read and ignored)
            ^
Step 2: "   -042" ('-' is read, so the result should be negative)
             ^
Step 3: "   -042" ("042" is read in, leading zeros ignored in the result)
               ^
```

Example 3:

```text
Input: s = "1337c0d3"
Output: 1337
Explanation:
Step 1: "1337c0d3" (no characters read because there is no leading whitespace)
         ^
Step 2: "1337c0d3" (no characters read because there is neither a '-' nor '+')
         ^
Step 3: "1337c0d3" ("1337" is read in; reading stops because the next character is a non-digit)
             ^
```

Example 4:

```text
Input: s = "0-1"
Output: 0
Explanation:
Step 1: "0-1" (no characters read because there is no leading whitespace)
         ^
Step 2: "0-1" (no characters read because there is neither a '-' nor '+')
         ^
Step 3: "0-1" ("0" is read in; reading stops because the next character is a non-digit)
          ^
```

Example 5:

```text
Input: s = "words and 987"
Output: 0
Explanation:
Reading stops at the first non-digit character 'w'.
```

Constraints:

- 0 <= s.length <= 200
- s consists of English letters (lower-case and upper-case), digits (0-9), ' ', '+', '-', and '.'.

## Solution

```java
class Solution {
    public int myAtoi(String s) {
        var val = 0;
        var pos = 1;
        var started = false;
        var negative = false;
        var overflow = false;

        for (var c : s.toCharArray()) {
            var i = ((int) c);

            // handle leading whitespace
            if (i == 32 && !started) {
                continue;
            }

            // handle leading -
            if (i == 45 && !started) {
                started = true;
                negative = true;
                continue;
            }

            // handle leading +
            if (i == 43 && !started) {
                started = true;
                negative = false;
                continue;
            }

            // adjust for digits
            i -= 48;

            // non-digit found
            if (i < 0 || i > 9) {
                break;
            }

            started = true;

            // if `val` is greater than this, then we will overflow
            var safe = ((Integer.MAX_VALUE - i) / 10);

            if (val > safe) {
                if (negative) {
                    return Integer.MIN_VALUE;
                } else {
                    return Integer.MAX_VALUE;
                }
            }

            // shift everything over one column
            val *= 10;

            // add the new value
            val += i;
        }

        if (negative) {
            val *= -1;
        }

        return val;
    }
}
```
