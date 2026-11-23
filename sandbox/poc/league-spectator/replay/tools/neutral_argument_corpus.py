"""Validate source-bound argument corpora without inventing a native observation."""
import hashlib
import json
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name('neutral-argument-corpus.schema.json')
SCHEMA = json.loads(SCHEMA_PATH.read_bytes())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def valid_digest(value):
    return isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def requests_for(records):
    if not isinstance(records, list) or not 0 < len(records) <= SCHEMA['x-maximumTotalRecords']:
        raise ValueError('Bounded original neutral arguments required')
    requests = {}
    for row in records:
        name, skin = row['character'], row['skinId']
        if (not isinstance(name, str) or not 0 < len(name) <= 128 or
                any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_' for c in name) or
                type(skin) is not int or not 0 <= skin <= 0xffffffff):
            raise ValueError('Original neutral character/skin identity required')
        requests[name.lower(), skin] = {'character': name.lower(), 'skinId': skin}
    if len(requests) > SCHEMA['properties']['requests']['maxItems']:
        raise ValueError('Bounded neutral request set required')
    return [requests[key] for key in sorted(requests)]


def load_neutral_argument_proof(file):
    inputs = {}

    def document(name):
        absolute = Path(name).resolve()
        if absolute.stat().st_size > SCHEMA['x-maximumProofBytes']:
            raise ValueError('Bounded neutral proof bytes required')
        data = absolute.read_bytes()
        inputs[str(absolute)] = digest(data)
        return json.loads(data)

    def identity(value):
        if any(value[key] != SCHEMA['properties'][key]['const'] for key in ['build', 'protocol', 'decoderImageSha256']):
            raise ValueError('Exact original neutral argument build required')

    def original(proof):
        identity(proof)
        if (type(proof['schema']) is not int or proof['schema'] != 1 or
                proof['kind'] != 'original-neutral-creation-factory-arguments' or proof['boundary'] is not None or
                proof['scope']['originalArgumentPrefixExecuted'] is not True or not valid_digest(proof['replaySha256']) or
                not isinstance(proof['sources'], dict) or not 0 < len(proof['sources']) <= 512):
            raise ValueError('Complete independent original neutral argument proof required')
        requests_for(proof['records'])
        for name, expected in proof['sources'].items():
            if not valid_digest(expected) or digest(Path(name).read_bytes()) != expected:
                raise ValueError('Original neutral argument producer changed: '+name)
        return proof

    value = document(file)
    proofs = []
    if value['kind'] == 'original-neutral-creation-factory-arguments':
        proofs.append({'file': str(Path(file).resolve()), 'sha256': inputs[str(Path(file).resolve())], 'proof': original(value)})
    else:
        identity(value)
        if (set(value) != set(SCHEMA['required']) or type(value['schema']) is not int or value['schema'] != 1 or
                value['kind'] != SCHEMA['properties']['kind']['const'] or not isinstance(value['sources'], list) or
                not 0 < len(value['sources']) <= SCHEMA['properties']['sources']['maxItems']):
            raise ValueError('Explicit bounded neutral argument corpus required')
        seen, replays = set(), set()
        for source in value['sources']:
            if (set(source) != set(SCHEMA['properties']['sources']['items']['required']) or
                    not isinstance(source['file'], str) or not 0 < len(source['file']) <= 2048 or
                    not valid_digest(source['sha256']) or not valid_digest(source['replaySha256']) or
                    type(source['records']) is not int or not 0 < source['records'] <= 10000 or
                    source['sha256'] in seen or source['replaySha256'] in replays):
                raise ValueError('Unique complete neutral corpus source required')
            seen.add(source['sha256'])
            replays.add(source['replaySha256'])
            proof = original(document(source['file']))
            if (inputs[str(Path(source['file']).resolve())] != source['sha256'] or
                    proof['replaySha256'] != source['replaySha256'] or len(proof['records']) != source['records']):
                raise ValueError('Neutral corpus source identity differs')
            proofs.append({'file': str(Path(source['file']).resolve()), 'sha256': source['sha256'], 'proof': proof})
    records = [row for source in proofs for row in source['proof']['records']]
    requests = requests_for(records)
    if value['kind'] == SCHEMA['properties']['kind']['const']:
        if (not isinstance(value['requests'], list) or any(not isinstance(row, dict) or
                set(row) != {'character', 'skinId'} or type(row['skinId']) is not int or
                not isinstance(row['character'], str) or row['character'] != row['character'].lower()
                for row in value['requests']) or value['requests'] != requests):
            raise ValueError('Neutral corpus request set differs from complete original sources')
    return {'document': value, 'proofs': proofs, 'records': records, 'requests': requests, 'inputs': inputs,
            **{key: value[key] for key in ['build', 'protocol', 'decoderImageSha256']}}
