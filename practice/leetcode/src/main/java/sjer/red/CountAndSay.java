package sjer.red;

import java.util.ArrayList;
import java.util.List;

// https://leetcode.com/discuss/interview-question/algorithms/124839/pinterest-reverse-count-and-say
public class CountAndSay {
  public static void main(String[] args) {
    System.out.println(sayAndCount(4));
  }

  public static String countAndSay(int n) {
    var str = "1";
    for (var i = 2; i <= n; i++) {
      var newStr = "";
      // we want to overwrite the string
      // iterate over the current string
      var count = 1;
      for (var x = 0; x < str.length(); x++) {
        // there are two cases: the this char is the same as the next, or it isn't. if it isn't, it might be because we're out of bounds
        // bounds check always first
        if (x + 1 < str.length() && str.charAt(x + 1) == str.charAt(x)) {
          // match!
          count += 1;
        } else {
          // no match
          newStr = newStr + count + str.charAt(x);
          count = 1;
        }
      }
      str = newStr;
    }
    return str;
  }

  public static List<String> sayAndCount(int n) {
    var l = new ArrayList<String>();
    var result = countAndSay(n);
    reverse(result, 0, "", "", l);
    return l;
  }

  // O(2^n)
  public static void reverse(String s, int index, String prev, String curr, List<String> ans) {
    if (index == s.length()) {
      if (curr.isEmpty()) {
        ans.add(prev);
      }
      return;
    }

    // keep building the chain
    reverse(s, index + 1, prev, curr + s.charAt(index), ans);

    // at each step we have two choices:
    if (!curr.isEmpty()) {
      var quantity = Integer.valueOf(curr);
      var character = s.charAt(index);
      for (int i = 0; i < quantity; i++) {
        prev = prev + character;
      }
      // we can consume this
      reverse(s, index + 1, prev, "", ans);
    }
  }
}
