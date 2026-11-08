"""Fetch the pinned, licensed Darwin C-locale errno table for native research."""
import argparse
import hashlib
from pathlib import Path
import urllib.request

COMMIT = '63976b830a836a22649b806fe62e8614fe3e5555'
URL = 'https://raw.githubusercontent.com/apple-oss-distributions/Libc/'+COMMIT+'/gen/errlst.c'
SHA256 = '7c3384292e8aac251c4528edf46a007beea194d3fb8431e1558ebd5fcc07a646'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    args = p.parse_args()
    target = args.cache.resolve()/'research/darwin-errlst.c'
    if target.exists():
        encoded = target.read_bytes()
    else:
        with urllib.request.urlopen(URL,timeout=30) as response:
            if response.status != 200:
                raise ValueError('Pinned Darwin runtime source did not return HTTP 200')
            encoded = response.read(65537)
    if len(encoded) > 65536 or hashlib.sha256(encoded).hexdigest() != SHA256:
        raise ValueError('Pinned Darwin runtime source hash/size differs')
    target.parent.mkdir(parents=True,exist_ok=True)
    if not target.exists():target.write_bytes(encoded)
    print(str(target)+' '+SHA256,flush=True)


if __name__ == '__main__':
    main()
