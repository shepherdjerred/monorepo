"""Explicit semantics for non-destructive vector operations in math kernels.

The pinned emulator's legacy operations remain available. Three-source VEX
forms are lowered to bounded call sites so their operands are materialized at
an execution boundary. Unknown forms stop rather than inherit legacy semantics.
"""
import ctypes as C
import math
import re
import struct
import capstone


def reg_index(dis,reg):
    name=dis.reg_name(reg)
    if not re.fullmatch(r'[xy]mm(?:[0-9]|1[0-5])',name):raise ValueError('Unsupported vector register')
    return int(name[3:])


def collect_instruction(dis,ins):
    if not ins.id or not ins.mnemonic.startswith('v') or len(ins.operands)<3:return None
    ops=ins.operands
    if any(ops[i].type!=capstone.CS_OP_REG or not dis.reg_name(ops[i].reg).startswith(('xmm','ymm')) for i in [0,1]):return None
    # These legacy instructions already have an explicit source and immediate;
    # VEX adds no non-destructive data operand to the admitted two-source form.
    if ins.mnemonic in ['vpshufd','vpshufhw','vpshuflw','vpermilps','vpermilpd']:return None
    third=ops[2]
    if third.type==capstone.CS_OP_REG:
        name=dis.reg_name(third.reg)
        source3={'register':reg_index(dis,third.reg)} if name.startswith(('xmm','ymm')) else {'integerRegister':name,'bytes':third.size}
    elif third.type==capstone.CS_OP_MEM:
        m=third.mem;source3={'memory':{'base':dis.reg_name(m.base) if m.base else None,'index':dis.reg_name(m.index) if m.index else None,
            'scale':m.scale,'displacement':m.disp,'bytes':third.size}}
    elif third.type==capstone.CS_OP_IMM:source3={'immediate':third.imm}
    else:raise ValueError('Unknown vector math operand')
    record={'rva':ins.address,'bytes':ins.size,'bytesHex':ins.bytes.hex(),'mnemonic':ins.mnemonic,
        'vectorBytes':ops[0].size,'destination':reg_index(dis,ops[0].reg),'source2':reg_index(dis,ops[1].reg),'source3':source3,
        'kind':'unsupported'}
    fma=re.fullmatch(r'(vfmadd|vfmsub|vfnmadd|vfnmsub)(132|213|231)(ss|sd|ps|pd)',ins.mnemonic)
    if fma:
        op,order,suffix=fma.groups();width=64 if suffix.endswith('d') else 32
        record.update(kind='fma',order=int(order),negateProduct=op.startswith('vfn'),subtractAddend=op.endswith('sub'),
            precision=width,lanes=1 if suffix.startswith('s') else ops[0].size//(width//8))
        return record
    arithmetic=re.fullmatch(r'v(add|sub|mul|div|max|min|sqrt)(ss|sd|ps|pd)',ins.mnemonic)
    if arithmetic:
        op,suffix=arithmetic.groups();width=64 if suffix.endswith('d') else 32
        record.update(kind='float',operation=op,precision=width,lanes=1 if suffix.startswith('s') else ops[0].size//(width//8),scalar=suffix.startswith('s'))
    elif ins.mnemonic in ['vandps','vandpd','vpand','vandnps','vandnpd','vpandn','vorps','vorpd','vpor','vxorps','vxorpd','vpxor']:
        record.update(kind='bits',operation='andn' if 'andn' in ins.mnemonic else 'and' if 'and' in ins.mnemonic else 'xor' if 'xor' in ins.mnemonic else 'or')
    elif ins.mnemonic in ['vcvtss2sd','vcvtsd2ss','vcvtsi2ss','vcvtsi2sd','vmovss','vmovsd']:
        record.update(kind='convert',precision=64 if ins.mnemonic.endswith('sd') else 32,
            sourcePrecision=32 if ins.mnemonic=='vcvtss2sd' else 64 if ins.mnemonic=='vcvtsd2ss' else 64 if ins.mnemonic=='vmovsd' else 32,
            integerSource=ins.mnemonic.startswith('vcvtsi'))
    elif ins.mnemonic in ['vshufps','vshufpd']:
        record.update(kind='shuffle',precision=64 if ins.mnemonic.endswith('pd') else 32,immediate=ops[3].imm)
    elif ins.mnemonic in ['vroundss','vroundsd']:
        record.update(kind='round',precision=64 if ins.mnemonic.endswith('sd') else 32,immediate=ops[3].imm)
    elif re.fullmatch(r'vps(ll|rl|ra)[dwq]',ins.mnemonic):
        record.update(kind='shift',operation=ins.mnemonic[3:5],precision={'w':16,'d':32,'q':64}[ins.mnemonic[-1]])
    elif re.fullmatch(r'vp(add|sub)[bwdq]',ins.mnemonic):
        record.update(kind='integer',operation='add' if 'add' in ins.mnemonic else 'sub',precision={'b':8,'w':16,'d':32,'q':64}[ins.mnemonic[-1]])
    elif re.fullmatch(r'vpcmp(eq|gt)[bwdq]',ins.mnemonic):
        record.update(kind='integer',operation='eq' if 'eq' in ins.mnemonic else 'gt',precision={'b':8,'w':16,'d':32,'q':64}[ins.mnemonic[-1]])
    elif ins.mnemonic in ['vunpcklps','vunpckhps','vunpcklpd','vunpckhpd']:
        record.update(kind='unpack',precision=64 if ins.mnemonic.endswith('pd') else 32,high=ins.mnemonic[6]=='h')
    elif re.fullmatch(r'vpunpck[lh](bw|wd|dq|qdq)',ins.mnemonic):
        record.update(kind='unpack',precision={'bw':8,'wd':16,'dq':32,'qdq':64}[ins.mnemonic[8:]],high=ins.mnemonic[7]=='h')
    return record


def execute_instruction(ins,dest,two,three,integer_bytes=8):
    vector_bits=ins['vectorBytes']*8;vector_mask=(1<<vector_bits)-1;kind=ins['kind']
    if kind=='bits':
        op=ins['operation'];return {'and':lambda:two&three,'andn':lambda:(~two)&three,'or':lambda:two|three,'xor':lambda:two^three}[op]()&vector_mask
    if kind in ['float','convert','round']:
        width=ins['precision'];mask=(1<<width)-1
        def number(value,bits):return struct.unpack('<f' if bits==32 else '<d',(value&((1<<bits)-1)).to_bytes(bits//8,'little'))[0]
        def encode(value,bits):
            value=C.c_float(value).value if bits==32 else value
            return int.from_bytes(struct.pack('<f' if bits==32 else '<d',value),'little')
        output=two&((1<<128)-1) if kind in ['convert','round'] or ins['scalar'] else 0
        lanes=1 if kind in ['convert','round'] else ins['lanes']
        for lane in range(lanes):
            left=(two>>(lane*width))&mask;right=(three>>(lane*width))&mask
            if kind=='round':
                control=ins['immediate']
                if control&4:raise ValueError('MXCSR-controlled rounding requires an explicit contract')
                value=number(three,width)
                if math.isfinite(value):
                    rounded=[round,math.floor,math.ceil,math.trunc][control&3](value)
                    value=math.copysign(0.0,value) if rounded==0 else float(rounded)
                result=encode(value,width)
            elif kind=='convert':
                if ins['integerSource']:
                    v=three&((1<<(integer_bytes*8))-1)
                    if v&(1<<(integer_bytes*8-1)):v-=1<<(integer_bytes*8)
                    value=float(v)
                else:value=number(three,ins['sourcePrecision'])
                result=encode(value,width)
            else:
                a,b=number(left,width),number(right,width);op=ins['operation']
                if op in ['max','min']:result=left if (a>b if op=='max' else a<b) else right
                else:
                    if op=='add':value=a+b
                    elif op=='sub':value=a-b
                    elif op=='mul':value=a*b
                    elif op=='div':value=a/b if b else math.nan if not a else math.copysign(math.inf,a*b if b else math.copysign(1,a)*math.copysign(1,b))
                    elif op=='sqrt':value=math.sqrt(b) if b>=0 else math.nan
                    else:raise ValueError('Unknown scalar operation')
                    result=encode(value,width)
            output=(output&~(mask<<(lane*width)))|(result<<(lane*width))
        return output&vector_mask
    if kind in ['integer','shift']:
        width=ins['precision'];mask=(1<<width)-1;output=0
        for lane in range(vector_bits//width):
            a=(two>>(lane*width))&mask;b=(three>>(lane*width))&mask;op=ins['operation']
            if kind=='shift':
                n=three&((1<<64)-1)
                if op=='ll':value=0 if n>=width else a<<n
                elif op=='rl':value=0 if n>=width else a>>n
                else:
                    signed=a-(1<<width) if a&(1<<(width-1)) else a;value=signed>>min(n,width)
            elif op=='add':value=a+b
            elif op=='sub':value=a-b
            elif op=='eq':value=mask if a==b else 0
            elif op=='gt':value=mask if (a-(1<<width) if a>>(width-1) else a)>(b-(1<<width) if b>>(width-1) else b) else 0
            else:raise ValueError('Unknown integer operation')
            output|=(value&mask)<<(lane*width)
        return output
    if kind in ['shuffle','unpack']:
        width=ins['precision'];mask=(1<<width)-1;output=0
        for block in range(vector_bits//128):
            a=[(two>>(block*128+i*width))&mask for i in range(128//width)]
            b=[(three>>(block*128+i*width))&mask for i in range(128//width)]
            if kind=='shuffle':
                imm=ins['immediate']
                values=[a[imm&3],a[(imm>>2)&3],b[(imm>>4)&3],b[(imm>>6)&3]] if width==32 else [a[(imm>>(block*2))&1],b[(imm>>(block*2+1))&1]]
            else:
                start=len(a)//2 if ins['high'] else 0;values=[]
                for i in range(start,start+len(a)//2):values.extend([a[i],b[i]])
            for i,value in enumerate(values):output|=value<<(block*128+i*width)
        return output
    raise ValueError(f"Unported vector math instruction {ins['mnemonic']} at {ins['rva']:x}")
