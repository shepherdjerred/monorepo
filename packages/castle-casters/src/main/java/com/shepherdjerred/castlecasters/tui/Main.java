package com.shepherdjerred.castlecasters.tui;

import com.shepherdjerred.castlecasters.tui.view.MainMenuView;
import com.shepherdjerred.castlecasters.tui.view.View;

import java.util.Scanner;

public class Main {

  public static void main(String[] args) throws InterruptedException {
    View view = new MainMenuView(new Scanner(System.in));
    boolean shouldContinue = true;

    while (shouldContinue) {
      var newView = view.display();
      if (newView.isPresent()) {
        view = newView.get();
      } else {
        shouldContinue = false;
      }
    }

    Thread.sleep(500);
    System.out.println("Exiting...");
  }
}
