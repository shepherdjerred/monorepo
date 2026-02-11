package com.shepherdjerred.castlecasters.engine.resource;

import lombok.Getter;
import lombok.extern.log4j.Log4j2;

import java.util.HashMap;
import java.util.Map;

/**
 * Handles the loading and reference counting of resources. Useful to ensure that resources are
 * shared safely and cleaned up when possible.
 */
@SuppressWarnings("unchecked")
@Log4j2
public class ResourceManager {

  private final Map<ResourceIdentifier, Resource> resourceCache;
  @Getter
  private final Map<ResourceIdentifier, Integer> referenceCounter;
  private final Map<Class<ResourceIdentifier>, ResourceLoader> loaders;

  public ResourceManager() {
    resourceCache = new HashMap<>();
    referenceCounter = new HashMap<>();
    loaders = new HashMap<>();
  }

  public <R extends Resource, I extends ResourceIdentifier> void registerLoader(Class<I> resourceType,
                                                                                ResourceLoader<I, R> provider) {
    loaders.put((Class<ResourceIdentifier>) resourceType, provider);
  }


  public <R extends Resource, I extends ResourceIdentifier> R get(I identifier) throws Exception {
    var currentReferences = referenceCounter.getOrDefault(identifier, 0) + 1;
    referenceCounter.put(identifier, currentReferences);

    log.trace("Allocating {}. New usage: {}", identifier, currentReferences);

    if (resourceCache.containsKey(identifier)) {
      return (R) resourceCache.get(identifier);
    } else {
      var loader = loaders.get(identifier.getClass());

      if (loader == null) {
        throw new UnsupportedOperationException("No loader exists for " + identifier);
      }

      var resource = loader.get(identifier);
      resourceCache.put(identifier, resource);
      return (R) resource;
    }
  }

  public <R extends Resource, I extends ResourceIdentifier> R getUnchecked(I identifier) {
    log.warn("Getting resource {} unsafely.", identifier);
    return (R) resourceCache.get(identifier);
  }

  public void free(ResourceIdentifier identifier) {
    if (!referenceCounter.containsKey(identifier)) {
      log.error("Freeing unallocated resource: {}", identifier);
      return;
    }
    var newReferenceCount = referenceCounter.get(identifier) - 1;
    log.trace(String.format("Freeing %s %s. New reference count is %s.",
        identifier.getClass().getSimpleName().replace("Name", ""),
        identifier,
        newReferenceCount));
    if (newReferenceCount < 0) {
      throw new IllegalStateException("Negative reference count.");
    } else if (newReferenceCount == 0) {
      log.trace("Resource {} no longer in use. Cleaning up.", identifier);
      resourceCache.get(identifier).cleanup();
      resourceCache.remove(identifier);
      referenceCounter.remove(identifier);
    } else {
      referenceCounter.put(identifier, newReferenceCount);
    }
  }

  public void freeAll() {
    log.info("Freeing all resources");
    resourceCache.values().forEach(Resource::cleanup);
  }

  public boolean hasAllocatedResources() {
    return !referenceCounter.isEmpty();
  }
}
