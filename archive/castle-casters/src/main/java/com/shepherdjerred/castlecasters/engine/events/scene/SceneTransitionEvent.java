package com.shepherdjerred.castlecasters.engine.events.scene;

import com.shepherdjerred.castlecasters.engine.scene.Scene;

public record SceneTransitionEvent(Scene newScene) implements SceneEvent {

}
