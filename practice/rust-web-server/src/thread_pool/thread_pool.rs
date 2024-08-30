use crate::thread_pool::worker::{Worker};
use std::sync::{mpsc, Arc, Mutex};
use crate::thread_pool::message::Message;

pub struct ThreadPool {
    sender: mpsc::Sender<Message>,
    workers : Vec<Worker>
}

impl ThreadPool {
    pub fn new(size: usize) -> ThreadPool {
        assert_ne!(size, 0);

        let (sender, receiver) = mpsc::channel();
        let receiver = Arc::new(Mutex::new(receiver));

        let mut workers = Vec::with_capacity(size);

        for id in 0..size {
            workers.push(Worker::new(id, Arc::clone(&receiver)));
        }

        ThreadPool {
            workers,
            sender
        }
    }

    pub fn execute<F>(&self, f: F) where F: FnOnce() + Send + 'static {
        let job = Box::new(f);
        self.sender.send(Message::NewJob(job)).unwrap();
    }
}

impl Drop for ThreadPool {
    fn drop(&mut self) {
        println!("Telling workers to terminate...");

        for _ in &mut self.workers {
            self.sender.send(Message::Terminate).unwrap();
        }

        for worker in &mut self.workers {
            println!("Shutting down worker {}", worker.id);
            worker.close();
        }
    }
}
