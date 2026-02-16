package com.shepherdjerred.castlecasters.engine.events.audio;

import com.shepherdjerred.castlecasters.engine.audio.SourcedAudio;
import com.shepherdjerred.castlecasters.events.Event;

public record PlayAudioEvent(SourcedAudio audio) implements Event {

}
