use crate::thread_pool::worker::Job;

pub enum Message {
    NewJob(Job),
    Terminate,
}