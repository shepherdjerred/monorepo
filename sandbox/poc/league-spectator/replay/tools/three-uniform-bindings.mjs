import { sha256 } from "../structural-comparison.mjs";
import { REPLAY_UNIFORM_BINDINGS_POLICY } from "../latest-renderer-policy.mjs";
import { assertReplaySamplerUniforms } from "../latest-renderer-samplers.mjs";

export const THREE_UNIFORM_BINDINGS_POLICY = REPLAY_UNIFORM_BINDINGS_POLICY;
export const THREE_UPSTREAM_SHA256 =
  "bbf5ed13fe4373f5bd38b14ea8e62e9f157327da5638edc6d3863e08b167c9c7";
// A deterministic adapter of the exact installed THREE release. GPU storage is
// still owned by each UniformsGroup; binding slots are reused across programs.
export async function adaptThreeUniformBindings(source) {
  const upstreamSha256 = await sha256(new TextEncoder().encode(source));
  if (upstreamSha256 !== THREE_UPSTREAM_SHA256)
    throw Error("Exact THREE r185.1 upstream source required for UBO adapter");
  const start = source.indexOf(
      "function WebGLUniformsGroups( gl, info, capabilities, state ) {",
    ),
    end = source.indexOf("\n/**\n * Precomputed DFG LUT", start);
  if (start < 0 || end < 0)
    throw Error("Exact THREE UniformsGroups source boundary required");
  let groups = source.slice(start, end);
  function replace(before, after) {
    if (
      groups.indexOf(before) < 0 ||
      groups.indexOf(before) !== groups.lastIndexOf(before)
    )
      throw Error("Exact unique THREE UBO source hunk required");
    groups = groups.replace(before, after);
  }
  replace(
    "let updateList = {};\n\tlet allocatedBindingPoints = [];",
    "let programLayouts = new WeakMap();\n\tconst ownedGroups = new Set();",
  );
  replace(
    "const maxBindingPoints = gl.getParameter( gl.MAX_UNIFORM_BUFFER_BINDINGS );",
    "const maxBindingPoints = gl.getParameter( gl.MAX_UNIFORM_BUFFER_BINDINGS );\n\tconst maxBlockSize = gl.getParameter( gl.MAX_UNIFORM_BLOCK_SIZE );\n\tif(!Number.isInteger(maxBindingPoints)||maxBindingPoints<=0||!Number.isInteger(maxBlockSize)||maxBlockSize<=0)throw new Error('Valid UBO hardware limits required');",
  );
  const bindStart = groups.indexOf(
      "\tfunction bind( uniformsGroup, program ) {",
    ),
    bindEnd = groups.indexOf("\n\tfunction update(", bindStart);
  if (bindStart < 0 || bindEnd < 0)
    throw Error("Exact THREE UBO bind boundary required");
  groups =
    groups.slice(0, bindStart) +
    `
  function layoutFor( program ) {
    if(program===null||typeof program!=='object'||program.program===null||typeof program.program!=='object')throw new Error('Linked WebGL UBO program required');
    const linked=program.program;
    let layout=programLayouts.get(linked);
    if(layout!==undefined)return layout;
    if(!gl.isProgram(linked)||!gl.getProgramParameter(linked,gl.LINK_STATUS))throw new Error('Linked WebGL UBO program required');
    const count=gl.getProgramParameter(linked,gl.ACTIVE_UNIFORM_BLOCKS);
    if(!Number.isInteger(count)||count<0||count>maxBindingPoints)throw new Error('Active UBO blocks exceed hardware binding capacity');
    layout=new Map();
    for(let index=0;index<count;index++){
      const name=gl.getActiveUniformBlockName(linked,index),size=gl.getActiveUniformBlockParameter(linked,index,gl.UNIFORM_BLOCK_DATA_SIZE),actual=gl.getUniformBlockIndex(linked,name);
      if(typeof name!=='string'||!name||layout.has(name)||actual!==index||!Number.isInteger(size)||size<=0)throw new Error('Invalid linked UBO reflection');
      layout.set(name,{index,size});
    }
    programLayouts.set(linked,layout);return layout;
  }
  function validate( uniformsGroups, program ) {
    const layout=layoutFor(program),names=new Set();
    if(!Array.isArray(uniformsGroups)||uniformsGroups.length!==layout.size)throw new Error('Complete active UBO group inventory required');
    for(const group of uniformsGroups){
      const block=layout.get(group.name);
      if(!block||names.has(group.name))throw new Error('Unique active UBO group names required');
      names.add(group.name);
      if(buffers[group.id]===undefined)prepareUniformsGroup(group);
      if(!Number.isInteger(group.__size)||group.__size<block.size||group.__size%16!==0||group.__size>maxBlockSize)throw new Error('UBO storage does not cover reflected block');
    }
  }
  function bind( uniformsGroup, program ) {
    const block=layoutFor(program).get(uniformsGroup.name),buffer=buffers[uniformsGroup.id];
    if(!block||buffer===undefined||uniformsGroup.__size<block.size)throw new Error('Prepared active UBO storage required');
    uniformsGroup.__bindingPointIndex=block.index;
    // This assignment is program-specific; global buffer bindings must always
    // follow the current draw, including switches between same-layout groups.
    gl.uniformBlockBinding(program.program,block.index,block.index);
    gl.bindBufferBase(gl.UNIFORM_BUFFER,block.index,buffer);
  }
` +
    groups.slice(bindEnd);
  const mappingStart = groups.indexOf(
      "\t\t// ensure to update the binding points/block indices mapping for this program",
    ),
    mappingEnd = groups.indexOf("\n\t}\n", mappingStart);
  if (mappingStart < 0 || mappingEnd < 0)
    throw Error("Exact THREE frame upload gate required");
  groups =
    groups.slice(0, mappingStart) +
    "\t\t// Values may change between draws within the same renderer frame.\n\t\tupdateBufferData( uniformsGroup );\n" +
    groups.slice(mappingEnd);
  replace(
    "\t\tconst bindingPointIndex = allocateBindingPointIndex();\n\t\tuniformsGroup.__bindingPointIndex = bindingPointIndex;\n\n",
    "",
  );
  replace(
    "\t\tgl.bindBufferBase( gl.UNIFORM_BUFFER, bindingPointIndex, buffer );\n",
    "",
  );
  const allocateStart = groups.indexOf(
      "\tfunction allocateBindingPointIndex() {",
    ),
    allocateEnd = groups.indexOf(
      "\n\tfunction updateBufferData(",
      allocateStart,
    );
  if (allocateStart < 0 || allocateEnd < 0)
    throw Error("Exact THREE persistent binding allocator required");
  groups = groups.slice(0, allocateStart) + groups.slice(allocateEnd);
  replace(
    "\t\tconst index = allocatedBindingPoints.indexOf( uniformsGroup.__bindingPointIndex );\n\t\tallocatedBindingPoints.splice( index, 1 );\n\n",
    "",
  );
  replace("\t\tdelete updateList[ uniformsGroup.id ];\n", "");
  replace(
    "\t\t\tuniformsGroup.addEventListener( 'dispose', onUniformsGroupsDispose );",
    "\t\t\tuniformsGroup.addEventListener( 'dispose', onUniformsGroupsDispose );\n\t\t\townedGroups.add( uniformsGroup );",
  );
  replace(
    "\t\tuniformsGroup.removeEventListener( 'dispose', onUniformsGroupsDispose );",
    "\t\tuniformsGroup.removeEventListener( 'dispose', onUniformsGroupsDispose );\n\t\townedGroups.delete( uniformsGroup );",
  );
  replace(
    "\tfunction dispose() {\n\n\t\tfor ( const id in buffers ) {",
    "\tfunction dispose() {\n\n\t\tfor ( const group of ownedGroups ) group.removeEventListener( 'dispose', onUniformsGroupsDispose );\n\t\townedGroups.clear();\n\n\t\tfor ( const id in buffers ) {",
  );
  replace(
    "\t\tallocatedBindingPoints = [];\n\t\tbuffers = {};\n\t\tupdateList = {};",
    "\t\tbuffers = {};\n\t\tprogramLayouts = new WeakMap();",
  );
  replace(
    "\t\tbind: bind,\n\t\tupdate: update,",
    "\t\tbind: bind,\n\t\tupdate: update,\n\t\tvalidate: validate,",
  );
  source = source.slice(0, start) + groups + source.slice(end);
  const hunk =
    "\t\t\t\tconst groups = material.uniformsGroups;\n\n\t\t\t\tfor ( let i = 0, l = groups.length; i < l; i ++ ) {";
  if (
    source.indexOf(hunk) < 0 ||
    source.indexOf(hunk) !== source.lastIndexOf(hunk)
  )
    throw Error("Exact THREE material UBO dispatch required");
  source = source.replace(
    hunk,
    "\t\t\t\tconst groups = material.uniformsGroups;\n\n\t\t\t\tuniformsGroups.validate( groups, program );\n\n\t\t\t\tfor ( let i = 0, l = groups.length; i < l; i ++ ) {",
  );
  const samplerDispatch =
    "\t\tfunction getUniformList( materialProperties ) {\n\n\t\t\tif ( materialProperties.uniformsList === null ) {";
  if (
    source.indexOf(samplerDispatch) < 0 ||
    source.indexOf(samplerDispatch) !== source.lastIndexOf(samplerDispatch)
  )
    throw Error("Exact THREE sampler list boundary required");
  source = source.replace(
    samplerDispatch,
    "\t\tfunction getUniformList( materialProperties, material ) {\n\n\t\t\tconst replayProgram = materialProperties.currentProgram;\n\t\t\tassertReplaySamplerUniforms( replayProgram.getUniforms().seq, materialProperties.uniforms, material, replayProgram, REPLAY_SAMPLER_FORMATS, false );\n\n\t\t\tif ( materialProperties.uniformsList === null ) {",
  );
  const upload =
    "WebGLUniforms.upload( _gl, getUniformList( materialProperties ), m_uniforms, textures );";
  if (source.split(upload).length !== 3)
    throw Error("Exact two THREE uniform upload boundaries required");
  source = source.replaceAll(
    upload,
    "assertReplaySamplerUniforms( p_uniforms.seq, m_uniforms, material, program, REPLAY_SAMPLER_FORMATS, true );\n\t\t\t\tWebGLUniforms.upload( _gl, getUniformList( materialProperties, material ), m_uniforms, textures );",
  );
  source += `\nconst REPLAY_SAMPLER_FORMATS = Object.freeze({integerFormats: [RedIntegerFormat, RGIntegerFormat, RGBAIntegerFormat], unsignedTypes: [UnsignedByteType, UnsignedShortType, UnsignedIntType]});\n${assertReplaySamplerUniforms.toString()}\nexport const REPLAY_UNIFORM_BINDINGS_POLICY = ${JSON.stringify(THREE_UNIFORM_BINDINGS_POLICY)};\n`;
  return {
    source,
    upstreamSha256,
    adaptedSha256: await sha256(new TextEncoder().encode(source)),
    policy: THREE_UNIFORM_BINDINGS_POLICY,
  };
}
