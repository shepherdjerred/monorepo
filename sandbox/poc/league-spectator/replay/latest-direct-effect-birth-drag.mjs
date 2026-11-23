import { sameDirectCompiledData as same } from "./latest-direct-compiled-restore.mjs";
const f=Math.fround, own=(value,keys)=>value!==null&&typeof value==="object"&&!Array.isArray(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),"value"));
const vec=value=>Array.isArray(value)&&value.length===3&&Reflect.ownKeys(value).length===4&&value.every(v=>typeof v==="number"&&Number.isFinite(f(v)));
const constantVec=value=>own(value,["__type","constantValue"])&&value.__type==="ValueVector3"&&vec(value.constantValue);
const constantFloat=(value,expected)=>own(value,["__type","constantValue"])&&value.__type==="ValueFloat"&&Object.is(value.constantValue,expected);
function zeroAngular(value){
 if(!own(value,["__type","dynamics"])||value.__type!=="ValueVector3"||!own(value.dynamics,["__type","probabilityTables","times","values"])||value.dynamics.__type!=="VfxAnimatedVector3fVariableData"||!same(value.dynamics.times,[0])||!same(value.dynamics.values,[[0,0,0]]))return false;
 return same(value.dynamics.probabilityTables,[{__type:"VfxProbabilityTableData",keyTimes:[0,0.8999999761581421,1],keyValues:[2,4,6]},...Array.from({length:2},()=>({__type:"VfxProbabilityTableData",keyTimes:[0,1],keyValues:[-1,1]}))]);
}
export const DIRECT_BIRTH_DRAG_POLICY="native-constant-birth-drag-zero-angular-two-burst-v1";
export function compileDirectBirthDrag(source,primitive,systemFlags){
 if(primitive!=="camera-quad"||systemFlags?.value!==212||systemFlags.authored!==false||source?.isSingleParticle!==1||!constantFloat(source.rate,2)||!constantFloat(source.bindWeight,0)||!constantVec(source.birthDrag)||!source.birthDrag.constantValue.every(v=>v>=0&&!Object.is(v,-0))||!constantVec(source.birthVelocity)||!zeroAngular(source.birthRotationalVelocity0)||!own(source.SpawnShape,["__type","emitOffset"])||source.SpawnShape.__type!=="{ee39916f}"||!vec(source.SpawnShape.emitOffset)||["rotation0","isRotationEnabled","particleIsLocalOrientation","FlexShapeDefinition","timeBeforeFirstEmission","worldAcceleration","acceleration","drag"].some(key=>Object.hasOwn(source,key)))return null;
 return {schema:1,policy:DIRECT_BIRTH_DRAG_POLICY,drag:source.birthDrag.constantValue.map(f),angularValue:structuredClone(source.birthRotationalVelocity0),expectedBurst:2,firstBirthElapsed:0,systemFlags:212,dragModeMask:0x100,dragModeBit:false,dragUpdateRva:0x175df00,positionUpdateRva:0x175e16c,rngOrder:"birth-scale-before-angular-before-retained-chance"};
}
export function validateDirectBirthDrag(emitter,systemFlags){
 const expected=compileDirectBirthDrag(emitter.source,emitter.primitive,systemFlags),actual=emitter.birthDragProgram;
 if(!expected){if(actual!=null||Object.hasOwn(emitter.source,"birthDrag"))throw Error("Unadmitted compiled birth-drag program");return null;}
 if(!same(expected,actual)||emitter.single!==true||emitter.bound!==false)throw Error("Malformed compiled birth-drag program");return expected;
}
export function sampleDirectBirthAngularVelocity(program,birth,age,random){
 if(program?.policy!==DIRECT_BIRTH_DRAG_POLICY||typeof birth?.sampleValue!=="function")throw Error("Owned zero-angular birth program required");
 const value=birth.sampleValue(program.angularValue,age,[0,0,0],random);
 if(!vec(value)||!value.every(v=>v===0))throw Error("Unproved nonzero sampled angular velocity");return value;
}
export function directClampedDragVelocity(velocity,drag,duration){
 if(!vec(velocity)||!vec(drag)||drag.some(v=>v<0)||!Number.isFinite(f(duration))||duration<0)throw Error("Finite native drag inputs required");
 const dt=f(duration);if(dt===0)return velocity.map(f);
 return velocity.map((raw,lane)=>{const v=f(raw),delta=f(f(f(-v)*f(drag[lane]))*dt),cross=f(f(v+delta)*v)<0;return f(v+(cross?f(-v):delta));});
}
export function validateDirectBirthAngularStorage(emitter,program){
 const has=Object.hasOwn(emitter,"birthAngularVelocities");
 if(!program?.birthDragProgram){if(has)throw Error("Unexpected birth-angular checkpoint storage");return;}
 const data=emitter.birthAngularVelocities;
 if(!has||!(data instanceof Float32Array)||Object.getPrototypeOf(data)!==Float32Array.prototype||!Number.isSafeInteger(emitter.capacity)||emitter.capacity<emitter.count||data.length!==emitter.capacity*3||data.byteOffset!==0||data.byteLength!==data.buffer.byteLength||!Array.from(data.subarray(0,emitter.count*3)).every(v=>v===0))throw Error("Invalid source-owned birth-angular checkpoint storage");
}
