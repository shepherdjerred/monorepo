# Book: High Performance Web Applications

## Latency

The time from the source sending a packet to the destination receiving it

## Bandwidth

Maxmimum throughput of a logical or physical communication path

## Propagation Delay

Amount of time required for a message to travel from the sender to receiver, which is a function of distance over speed with which the signal propagates

## Transmission Delay

Amount of time required to push all the packet's bits into the link, which is a function of the packet's length and data rate of the link.

## Processing Delay

Amount of time required to process the packet header, check for bit-level errors, and determine the packet's destination

## Queuing Delay

Amount of time the incoming packet is waiting in the queue until it can be processed

## Time to go from New York to San Francisco at the speed of light in a vacuum

14ms

## Time to go from New York to London at the speed of light in a vacuum

19ms

## Time to go from New York to Sydney at the speed of light in a vacuum

53ms

## Performance bottleneck for most websites

Latency

## WDM

Wavelength-Division Multiplexing; Allows a single cable of optical fiber to carry multiple streams of data

## Bandwidth of a fiber optic cable

Bandwidth of one channel times number of channels

## IP

Internet Protocol

## TCP

Transmission control protocol

## UDP

User datagram protocol

## Functions of TCP

* Reliable data transfer over an unreliable channel.
* Retransmission of lost data, * In-order delivery
* Congestion control
* Congestion avoidance

## Three-way handshake

1. SYN
1. SYN ACK
1. ACK

Client send SYN, server sends SYN ACK, client sends ACK. Must be done before any data is transmitted. Allows client and server to agree on packet sequence numbers.

## Three-way handshake latency

Adds a full round-trip of latency before any application data is transmitted

## TCP Fast Open (TFO)

Allows data transfer within the SYN packet. Only works with certain HTTP requests

## Congestion Collapse

Occurs due to an interaction between TCP and IP when gateways connect two networks with widely different bandwidth. Led to the addition of:

* Flow control
* Congestion control
* Congestion avoidance

## Flow control

A mechanism that prevents the sender from overwhelming the receiver

## rwnd

Recieve window. Communicates the size of the available buffer space to hold incoming data. Included as part of every ACK packet. A value of zero indicates that no more data should be sent until the buffer has been cleared.

## TCP Window Scaling

Allows the maximum receive window to be raised from 65,535 bytes to 1 gigabyte. Indicated during the three-way handshake -- must be supported by both sender and receiver.

## cwnd

Congestion window. Sender-side limit on the amount of data the sender can have in flight before receiving an ACK from the client. Not exchanged between sender and receiver.

## TCP Slow Start

cwnd starts with a small value (10 segments circa April 2013) and grows as packets are ACK'd.
