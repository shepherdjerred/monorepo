package com.shepherdjerred.castlecasters.network.netty.handlers;

import io.netty.channel.ChannelDuplexHandler;
import io.netty.channel.ChannelHandlerContext;
import lombok.extern.log4j.Log4j2;

@Log4j2
public class ExceptionLoggerHandler extends ChannelDuplexHandler {

  @Override
  public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
    log.error(cause);
  }
}
