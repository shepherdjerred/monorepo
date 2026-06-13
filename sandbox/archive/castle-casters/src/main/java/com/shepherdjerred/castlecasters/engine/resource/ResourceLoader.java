package com.shepherdjerred.castlecasters.engine.resource;

public interface ResourceLoader<I extends ResourceIdentifier, R extends Resource> {

  R get(I identifier) throws Exception;
}
