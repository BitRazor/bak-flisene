// A small GLSL lint for the effects' shaders (used by tests/fx.test.js; no browser needed). It applies a material's
// onBeforeCompile patch to three.js's real shader text, resolves the #includes, and checks for the mistakes that most
// often stop a WebGL 2 (GLSL ES 3.00) shader from compiling: integer literals in float maths, reserved words, names
// never declared, uniforms without a value of the right kind, varyings the vertex stage never writes, duplicate
// definitions and unbalanced brackets. It does not check vector sizes or argument types.
import * as THREE from 'three';

export const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

export function resolveIncludes(src) {
  return src.replace(/^[ \t]*#include +<([\w./]+)>/gm, (m, name) => {
    const chunk = THREE.ShaderChunk[name];
    if (chunk === undefined) throw new Error(`missing shader chunk ${name}`);
    return resolveIncludes(chunk);
  });
}

export function assemble(mat) {
  if (mat.isShaderMaterial) {
    return { uniforms: mat.uniforms, vertexShader: mat.vertexShader, fragmentShader: mat.fragmentShader };
  }
  const lib = mat.isMeshPhysicalMaterial ? THREE.ShaderLib.physical : THREE.ShaderLib.standard;
  const shader = {
    uniforms: THREE.UniformsUtils.clone(lib.uniforms),
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
  };
  mat.onBeforeCompile(shader, null);
  return shader;
}

const GLSL_TYPES = 'void bool int uint float vec2 vec3 vec4 bvec2 bvec3 bvec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 mat2 mat3 mat4 sampler2D samplerCube';
const GLSL_KEYWORDS = `${GLSL_TYPES} const uniform in out inout attribute varying if else for while do return discard break continue
  struct true false highp mediump lowp precision`;
const GLSL_BUILTINS = `radians degrees sin cos tan asin acos atan sinh cosh tanh pow exp log exp2 log2 sqrt inversesqrt abs sign floor
  trunc round ceil fract mod min max clamp mix step smoothstep isnan isinf length distance dot cross normalize faceforward reflect
  refract transpose determinant inverse lessThan greaterThan equal notEqual any all not texture texture2D textureLod dFdx dFdy fwidth
  gl_Position gl_FragColor gl_FragCoord gl_FrontFacing gl_PointSize gl_InstanceID gl_VertexID`;
// GLSL ES 3.00 reserved words and keywords that may not be used as names
const GLSL_RESERVED = `common partition active asm class union enum typedef template this resource goto inline noinline public static
  extern external interface long short half fixed unsigned superp input output hvec2 hvec3 hvec4 fvec2 fvec3 fvec4 filter sizeof
  cast namespace using sample coherent volatile restrict readonly writeonly atomic_uint noperspective patch subroutine buffer shared
  smooth flat centroid invariant layout switch case default`;
const words = (s) => new Set(s.split(/\s+/).filter(Boolean));
const TYPES = words(GLSL_TYPES);
const KEYWORDS = words(GLSL_KEYWORDS);
const BUILTINS = words(GLSL_BUILTINS);
const RESERVED = words(GLSL_RESERVED);
// declared by three.js's prefix for every non-raw shader (WebGLProgram)
const PREFIX = words(`position normal uv modelMatrix modelViewMatrix projectionMatrix viewMatrix normalMatrix cameraPosition
  isOrthographic instanceMatrix toneMapping linearToOutputTexel`);

export function tokens(src) {
  const out = [];
  const re = /([A-Za-z_]\w*)|(\d+\.\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+|\d+)|(\S)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) out.push({ t: 'id', s: m[1] });
    else if (m[2]) out.push({ t: 'num', s: m[2], int: !/[.eE]/.test(m[2]) });
    else out.push({ t: 'p', s: m[3] });
  }
  return out;
}

// names declared anywhere in a stage: "<word> <name>" followed by = ; [ , ) or (, plus #defines
export function declaredNames(src) {
  const s = stripComments(src);
  const set = new Set(PREFIX);
  for (const m of s.matchAll(/\b[A-Za-z_]\w*\s+([A-Za-z_]\w*)\s*(?:=|;|\[|,|\)|\()/g)) set.add(m[1]);
  for (const m of s.matchAll(/#define\s+([A-Za-z_]\w*)/g)) set.add(m[1]);
  return set;
}

// Lint one snippet of my own GLSL. Returns a list of problems.
export function lintSnippet(name, src, declared) {
  const problems = [];
  const code = stripComments(src).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const tk = tokens(code);
  let bracket = 0;
  let paren = 0;
  let forParen = -1;
  for (let i = 0; i < tk.length; i++) {
    const t = tk[i];
    if (t.t === 'p') {
      if (t.s === '[') bracket++;
      if (t.s === ']') bracket--;
      if (t.s === '(') paren++;
      if (t.s === ')') { paren--; if (paren === forParen) forParen = -1; }
      continue;
    }
    if (t.t === 'id' && t.s === 'for' && tk[i + 1] && tk[i + 1].s === '(') forParen = paren;
    if (t.t === 'num' && t.int && bracket === 0 && forParen < 0) {
      problems.push(`${name}: integer literal ${t.s} in float maths (write ${t.s}.0) near "${tk.slice(Math.max(0, i - 3), i + 2).map((x) => x.s).join(' ')}"`);
    }
    if (t.t === 'id') {
      const prev = tk[i - 1];
      if (prev && prev.s === '.') continue; // swizzle or struct member
      if (RESERVED.has(t.s)) problems.push(`${name}: reserved word "${t.s}"`);
      const isDeclaration = prev && prev.t === 'id' && (TYPES.has(prev.s) || prev.s === 'in' || prev.s === 'out');
      if (isDeclaration && BUILTINS.has(t.s)) problems.push(`${name}: "${t.s}" hides a built-in function`);
      if (isDeclaration && KEYWORDS.has(t.s)) problems.push(`${name}: keyword "${t.s}" used as a name`);
      if (!KEYWORDS.has(t.s) && !BUILTINS.has(t.s) && declared && !declared.has(t.s)) {
        problems.push(`${name}: "${t.s}" is not declared anywhere in this shader`);
      }
    }
  }
  if (bracket !== 0 || paren !== 0) problems.push(`${name}: unbalanced brackets`);
  return problems;
}

// bracket balance: three.js's own lights_physical_pars_fragment has one more "{" than "}" (two #if-alternative
// function headers share a body), so what must balance is what a patch ADDS to the original shader
export function bracketCounts(src) {
  const s = stripComments(src);
  const c = (ch) => s.split(ch).length - 1;
  return [c('(') - c(')'), c('{') - c('}'), c('[') - c(']')];
}

// Checks on a whole assembled stage. original: three.js's unpatched text of that stage ('' for my own shaders).
export function lintStage(label, stage, src, uniforms, otherStage, original = '') {
  const problems = [];
  const s = stripComments(src);
  const a = bracketCounts(s);
  const b = bracketCounts(original);
  if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) problems.push(`${label} ${stage}: the patch adds unbalanced brackets`);
  // my uniforms exist and carry the right kind of value
  for (const m of s.matchAll(/\buniform\s+(\w+)\s+(uFx\w+)\s*(\[\s*(\d+)\s*\])?/g)) {
    const [, type, uname, , len] = m;
    const u = uniforms[uname];
    if (!u) { problems.push(`${label} ${stage}: uniform ${uname} has no value`); continue; }
    const v = u.value;
    const ok = len ? (v && v.length === Number(len))
      : type === 'float' ? typeof v === 'number'
        : type === 'vec2' ? v && v.isVector2
          : type === 'vec3' ? v && (v.isVector3 || v.isColor)
            : type === 'sampler2D' ? v && v.isTexture : true;
    if (!ok) problems.push(`${label} ${stage}: uniform ${uname} (${type}${len ? `[${len}]` : ''}) has a wrong value`);
  }
  // nothing of mine declared twice
  const counts = new Map();
  for (const m of s.matchAll(/\b(?:uniform|varying|attribute)\s+\w+\s+((?:uFx|vFx|a|i)\w*)\b/g)) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  for (const m of s.matchAll(/\b(?:float|vec[234]|void|int)\s+(fx_\w+)\s*\([^)]*\)\s*\{/g)) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  for (const [n, k] of counts) if (k > 1) problems.push(`${label} ${stage}: ${n} declared ${k} times`);
  // every varying the fragment reads is written by the vertex stage with the same type
  if (stage === 'fragment' && otherStage) {
    const vs = stripComments(otherStage);
    for (const m of s.matchAll(/\bvarying\s+(\w+)\s+(vFx\w+)/g)) {
      if (!new RegExp(`\\bvarying\\s+${m[1]}\\s+${m[2]}\\b`).test(vs)) problems.push(`${label}: varying ${m[1]} ${m[2]} missing in the vertex stage`);
      if (!new RegExp(`\\b${m[2]}\\s*=`).test(vs)) problems.push(`${label}: varying ${m[2]} is never written`);
    }
  }
  return problems;
}
