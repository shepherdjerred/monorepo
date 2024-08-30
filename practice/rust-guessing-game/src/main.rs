use std::io;
use std::io::Read;
use rand::prelude::*;

fn main() {
    println!("Guess the number from 0-20!");
    println!("Enter your guess:");
    let mut guess = String::new();
    io::stdin().read_line(&mut guess).expect("Error while reading STDIN");
    let guess_as_int: i32 = guess.trim_end().parse().unwrap();
    println!("Your guess was {}", guess);
    let mut rng = thread_rng();
    let target = rng.gen_range(0..21);
    if guess_as_int == target {
        println!("Correct! The target was {}", target);
        return;
    }
    println!("Incorrect! The target was {}", target);
}
