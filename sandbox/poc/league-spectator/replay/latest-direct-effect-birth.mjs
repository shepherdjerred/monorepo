// Call order is part of the particle program, including the retained chance
// after authored birth values. Point/arbitrary native observations compare
// every output lane and the final stream state with identical supplied seeds.
import { sampleDirectBirthAngularVelocity } from "./latest-direct-effect-birth-drag.mjs";
export function sampleDirectEffectBirth(birth, source, age, random, angularProgram=null) {
  const sample = (key, fallback) =>
    birth.sampleValue(source[key], age, fallback, random);
  const life=sample("particleLifetime",0),color=sample("birthColor",[1,1,1,1]),scale=sample("birthScale0",[1,1,1]),rotation=sample("birthRotation0",[0,0,0]),angularVelocity=angularProgram?sampleDirectBirthAngularVelocity(angularProgram,birth,age,random):null,velocity=sample("birthVelocity",[0,0,0]),chance=random.next();
  return {life,color,scale,rotation,velocity,chance,...(angularProgram?{angularVelocity}:{})};
}
