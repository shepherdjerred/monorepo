from pathlib import Path
import hashlib, json, struct, time, sys
from rofllens import ReplayReader
from rofllens.decoders.emulator import UnicornDecoderEngine
from rofllens.decoders.movement import parse_movement_payloads

if len(sys.argv) != 5: raise SystemExit('Usage: python native-oracle.py <research-root> <exe> <replay> <output-dir>')
root = Path(sys.argv[1])
profile = root / 'rofllens/src/rofllens/profiles/16.14.794.5912-34de26710352/profile.json'
exe = Path(sys.argv[2])
if hashlib.sha256(exe.read_bytes()).hexdigest() != '34de26710352fcf4360b27691cecf77843a0ea338cd455be4fabb63fb467984f': raise ValueError('Executable hash mismatch')
replay_path = Path(sys.argv[3])
if hashlib.sha256(replay_path.read_bytes()).hexdigest() != 'c4b19a56c2451601591815febb3513d53e7b38f95ab8937e4b417293aead6d85': raise ValueError('Fixture hash mismatch')
engine = UnicornDecoderEngine(profile, exe)
digest = hashlib.sha256()
count = 0
started = time.monotonic()
out = Path(sys.argv[4])
out.mkdir(parents=True, exist_ok=True)
with ReplayReader.open(replay_path) as replay, (out/'oracle.jsonl').open('w') as f:
    for block in replay.iter_blocks(streams={'gameChunk'}, opcodes={0x22c}, include_payload=True):
        decoded = engine.run_decoder('movementPath', block.payload).payload
        digest.update(struct.pack('<I',len(decoded)))
        digest.update(decoded)
        paths = parse_movement_payloads(decoded)
        f.write(json.dumps({'time':block.timestamp,'chunkId':block.chunk_id,'blockOffset':block.block_offset,'hex':decoded.hex(),'paths':paths})+'\n')
        count += 1
        if count % 5000 == 0: print(count, round(time.monotonic()-started,1), flush=True)
result = {'packets':count,'sha256':digest.hexdigest(),'seconds':time.monotonic()-started}
(out/'oracle-summary.json').write_text(json.dumps(result,indent=2))
print(result)

from rofllens.decoders.profile import load_profile
from rofllens.decoders.base import DecoderContext
from rofllens.decoders.animation import AnimationStateDecoder
p=load_profile(profile)
context=DecoderContext(p,p.client_version,p.protocol_digest,p.client_sha256)
decoder=AnimationStateDecoder(engine)
swap=lambda v: ((v&85)<<1)|((v>>1)&85)
count=0
with ReplayReader.open(replay_path) as replay, (out/'animations-oracle.jsonl').open('w') as f:
 for b in replay.iter_blocks(streams={'gameChunk'},opcodes={35,403,928},include_payload=True):
  if not 0x400000ae <= b.param < 0x400000b8: continue
  event=decoder.decode(b,context)
  selector=(int.from_bytes(b.payload[:3],'little')>>7)&7
  rate=event.fields['rawRate']
  if selector not in (0,7,4,2):
   observation=engine.observe_decoder('animationState',b.payload)
   raw=bytes(((swap(v)-0x52)&255)^0xfe for v in observation.output_snapshot[0x14:0x18])
   rate=struct.unpack('<f',raw)[0]
  f.write(json.dumps({'time':b.timestamp,'entityId':b.param,'opcode':b.packet_id,'payload':b.payload.hex(),'fields':event.fields,'finalObjectRate':rate})+'\n')
  count+=1
print('Animation oracle:',count)
