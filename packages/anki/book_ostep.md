# OSTEP

## Components of a CPU cycle

Components of a CPU cycle

## CPU Fetch

Get the next instruction from memory

## CPU Decode

Figure out what the instruction is

## CPU Execute

Execute the fetched & decoded instruction

## System call

The API for an OS. Supported by hardware instructions and state.

## Virtualization

Taking a physical resource and transforming it into something more general, powerful, and easy-to-use

## The three easy pieces

Virtualization, concurrency, persistance

## Trap

A special hardware instruction to perform system calls

## Multiprogramming

Running multiple programs, not necessarily at the same time

## Process

An abstraction representing a running program

## Time sharing

Creating the illusion of multiple CPUs by running programs in small chunks, stopping it and running another, etc.

## Mechanism

The low-level methods or protocols needed to implemented a piece of functionality

## Time-sharing

A technique used by an OS to share a resource by allowing the resource to be used a little bit by one entity, the switching entities, and so forth.

## Space sharing

The counterpart to time sharing. A resource is divided among the entities that wish to use it.

## Policy

Algorithms for making decisions within an OS. They usually pair with mechanism. For example, a scheduling policy would describe when to switch processes, whereas context switches would describe how.

## Address space

The memory that a process can address

## Program Counter (PC)

AKA the Instruction Pointer (IP). Indicates which instruction the program is currently executing

## Stack Pointer and Frame Pointer

Manage the stack for function parameters, local variables, and return addresses

## Steps to initialize a process

1. Load code and static data into the address space of the process
1. Allocate memory for the stack (and possibly heap)
1. Other tasks, e.g. file descriptors
1. Jump to main and transfer control

## Process States

* Running
* Ready
* Blocked

## Process State: Running

The process is actively running on the processor.

## Process State: Ready

The process is ready to run, but the OS has chosen not to run it at the moment

## Process State: Blocked

The process is performing some kind of operation that makes it not ready to run until some other event takes place, e.g. I/O.

## Register context

Holds the contents of the CPU registers for a paused process

## Context switch

Occurs when the active process is switching. The registers of the descheduled process are saved to the register context/kernel stack. The registers of the scheduled process are loaded into the CPU registers.

## Process List

A data structure the OS uses to keep track of process schedule states and other information

## Zombie Process

A process state where a process has exited but not cleaned up

## Process Descriptor

The technical name for the data structure contained in the process list. Also known as Process Control Block (PCB)

## fork()

Creates a near exact copy of the running program. The new process will have its own PID, address space, registers, etc.

## wait()

Waits for a process to exit

## exec()

Overwrites the current process with another programs code, static data, registers, etc.

## kill()

Sends signals to a process

## Direct Execution

Letting a program run directly on a CPU

## Limited Direct Execution

Limits what a process can do, e.g. restricting system calls

## User mode

A processer mode that restricts system calls.

## Kernel mode

An unrestricted CPU mode, the OS runs here

## Executing a system call from user mode

The user mode program executes a trap instruction with information about what needs to be done, e.g. what system call to execute. This elevates the CPU to kernel mode. The CPU will save any needed registers that the program has onto a per-process kernel stack. The OS does executes the system call if allowed. The OS calls a return-from-trap instruction that continues program execution and returns the CPU to user mode.

## Kernel Stack

Per-process registers are saved here during system calls from user-mode programs

## Trap table

Set at boot time in kernel mode. This maps system calls to memory locations, so that when traps occur the CPU knows where to go to execute code to handle the trap.

## Trap handler

Code that the CPU executes to handle a system call. These are loaded into the trap table.

## System-call number

A number representing the system call to be executed during a trap from a user-mode program

## Cooperative Scheduling

A process cedes control of the CPU, e.g. by making system calls

## Timer interrupt

A timer device interrupts the CPU on a schedule so that process switching can occur. A pre-configured interrupt handler is executed, which allows the OS to regain control of the CPU.

## Scheduler

Determines which process to run

## Workload

The processes running on a system

## Turnaround Time

The time that a job completes minus the time that the job was received

## FIFO

First-in first-out

## FCFS

First-come first-serve

## Convoy effect

Short processes get queued behind a long-running process

## SJF

Shortest job first

## STCF

Shorted time to completion first

## Non-preemptive Scheduling

Jobs are run to completion before a new job can be run

## Preemptive scheduling

Processes are stopped mid-execution so that other processes can get a chance to run

## Response Time

The time from when a job arrives to when it is first scheduled

## Round Robin

Good for response time, fair, but inefficient

## Time slice

AKA scheduling quantum. Processes run for a very short amount of time before another is scheduled and executed.

## Amortization

Distributing a cost over the lifetime of something. e.g. a 1ms context switch can be amortized over a 10ms time slice giving 90% utilization. The time slice can be increased to 100ms which increases utilization to 99%.

## Overlap

Running another process when a process using the CPU is performing I/O or some other blocking call.

## MLFQ

Multi-level feedback queue.

A scheduling algorithm for processes that contains multiple queues. Higher priority queues are reserved for interactive processes and run for short time slices. Lower priority queues are for batch processes and run for longer time slices. Process priority is adjusted based on process behavior, e.g. how much CPU time a process uses.
