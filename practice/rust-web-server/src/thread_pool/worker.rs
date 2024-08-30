use std::thread;
use std::sync::{mpsc, Mutex, Arc};
use crate::thread_pool::fn_box::FnBox;
use crate::thread_pool::message::Message;

pub type Job = Box<dyn FnBox + Send + 'static>;

pub struct Worker {
    pub id: usize,
    thread: Option<thread::JoinHandle<()>>,
}

impl Worker {
    pub(crate) fn new(id: usize, receiver: Arc<Mutex<mpsc::Receiver<Message>>>) -> Worker {
        let thread = thread::spawn(move || {
            loop {
                let message = receiver.lock().unwrap().recv().unwrap();

                match message {
                    Message::NewJob(job) => {
                        println!("Worker {} got a job; executing.", id);
                        job.call_box();
                    },
                    Message::Terminate => {
                        println!("Terminating worker {}", id);
                        break;
                    }
                }
            }
        });
        Worker {
            id,
            thread: Some(thread),
        }
    }

    pub fn close(&mut self) {
        if let Some(thread) = self.thread.take() {
            thread.join().unwrap()
        }
    }
}
