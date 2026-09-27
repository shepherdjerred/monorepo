package com.shepherdjerred.thestorm.agent.app;

import com.shepherdjerred.thestorm.tickets.app.TicketService;
import java.time.InstantSource;
import java.util.random.RandomGenerator;

/**
 * Everything the agent flows share: the brain, the decision log, the ticket queue, time, the
 * config, and randomness for spot-check sampling. One record keeps the flow constructors honest.
 *
 * @param brain the classifier and triager
 * @param log the decision log
 * @param tickets the ticket queue
 * @param time the clock
 * @param config the agent config
 * @param random the sampler's coin, seeded in tests
 */
public record AgentServices(
    BrainClient brain,
    DecisionLog log,
    TicketService tickets,
    InstantSource time,
    AgentConfig config,
    RandomGenerator random) {}
