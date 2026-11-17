export const POOLS = ["!1l|;:", "rtf]cvxz=+", "ncoenO()[]<>", "O8B$#&%Q"];
const RAMP = " .,;:!~+*^01|/\\-_#()x";
export const CHARS = RAMP + POOLS.join("");
export const FILL = POOLS.map((pool) =>
  Array.from({ length: 12 }, (_, index) => pool[index % pool.length]),
);
export const TANGENTS = ["-", "/", "|", "\\"];
export const MARKS = ["*", "+", "."];

const PRELUDE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec2 uRes;
uniform float uAspect;
uniform float uT;
uniform float uScroll;
uniform vec3 uInk;
uniform vec3 uAccent;
uniform float uFill[48];
uniform float uGlyph[7];
out vec4 outColor;

const float PI = 3.14159265;
const float TAU = 6.28318531;

float sm(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
float sq(float x) { return x * x; }

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float slotOf(float heat, float k) {
  float level = clamp(floor(clamp(heat, 0.0, 1.4) * 3.6), 0.0, 3.0);
  return uFill[int(level) * 12 + int(mod(k, 12.0))];
}

vec4 emit(float heat, vec3 color, float k) {
  if (heat < 0.02) return vec4(0.0);
  float lum = 0.4 + 0.6 * clamp(heat, 0.0, 1.0);
  return vec4(color * lum, slotOf(heat, k) / 255.0);
}

vec4 emitSlot(float heat, vec3 color, float slot) {
  if (heat < 0.02) return vec4(0.0);
  float lum = 0.4 + 0.6 * clamp(heat, 0.0, 1.0);
  return vec4(color * lum, slot / 255.0);
}
`;

const MAIN = `
void main() {
  vec2 p = vec2((vUV.x - 0.5) * uAspect, 0.5 - vUV.y);
  vec4 color = vec4(0.0);
  scene(p, floor(vUV * uRes), color);
  outColor = color;
}
`;

const BLACK_HOLE = `
const float RO = 0.11;
const float TILT = 0.29670597;
const float INC = 0.12;
const float R_IN = 0.1705;
const float R_OUT = 0.594;
const float FLASH = 7.0;
const vec3 DEEP = vec3(190.0, 38.0, 12.0) / 255.0;
const vec3 RED = vec3(242.0, 78.0, 20.0) / 255.0;
const vec3 ORANGE = vec3(255.0, 124.0, 34.0) / 255.0;
const vec3 AMBER = vec3(255.0, 172.0, 78.0) / 255.0;
const vec3 HOT = vec3(255.0, 222.0, 160.0) / 255.0;
const vec3 STAR = vec3(220.0, 228.0, 255.0) / 255.0;

float spinAt(float t) {
  float s = max(t - FLASH, 0.0);
  return 0.06 * t + 0.28 * (s - 0.8 * (1.0 - exp(-s / 0.8)));
}

float rippleAt(float a, float b, float t) {
  return sin(a + 0.9 * sin(b + 1.3 * t)) * 0.5
       + sin(2.3 * a - b + 0.7 * t) * 0.3
       + sin(4.1 * a + 1.7 * b - 1.1 * t) * 0.2;
}

vec3 gasAt(float phi, float rho, float t, float w) {
  float phase = phi - pow(rho / R_IN, -1.5) * w;
  float lr = log(rho / RO);
  float a = 4.6 * lr + 0.9 * sin(phase + 3.0 * lr);
  float streak = 0.55 + 0.3 * sin(a) + 0.15 * sin(2.3 * a + 2.0 * phase)
               + 0.12 * sin(3.0 * phase - 7.0 * lr + 0.3 * t);
  float pulses = 0.0;
  for (int i = 0; i < 2; i++) {
    float ringR = i == 0 ? 1.8 : 3.2;
    float start = i == 0 ? 0.0 : 4.2;
    float speed = i == 0 ? 0.9 : 0.65;
    float d = mod(phase - start - speed * t + PI, TAU) - PI;
    float comet = d > 0.0 ? exp(-sq(d / 0.18)) : exp(d / 0.9);
    pulses += comet * exp(-sq((lr - log(ringR)) / 0.07));
  }
  return vec3(streak + 0.9 * sm((t - FLASH) / 1.0) * pulses, phase, lr);
}

vec4 diskAt(vec2 p, float t, float w, float inc) {
  float yy = p.y / (0.10 + 2.1 * inc);
  float r = length(vec2(p.x, yy));
  float arg = atan(yy, p.x);
  float tap = 0.5 - 0.5 * sin(arg - TILT);
  float side = pow(abs(cos(arg - TILT)), 3.0);
  float outR = max(r - 1.1 * RO, 0.0);
  float band = exp(-sq(outR / (0.2 * RO + 0.24 * RO * tap + 0.45 * RO * side)))
             * exp(-sq(min(r - 1.1 * RO, 0.0) / (0.2 * RO)));
  float rho = mix(R_IN + max(r - 2.0 * RO, 0.0) * 2.6, max(r, R_IN), side);
  vec3 g = gasAt(arg - TILT, rho, t, w);
  float body = sm((r - R_IN) / (0.4 * R_IN)) * sq(R_IN / r)
             * (1.0 - sm((r - 0.55 * R_OUT) / (0.45 * R_OUT)));
  float disk = 2.6 * (band + 0.85 * body) * g.x * (0.3 + 0.8 * tap)
             * (1.0 - 0.25 * cos(arg - TILT));
  return vec4(disk, yy, g.y, g.z);
}

float haloAt(float r, float arg, float t, float w, float px) {
  float k = cos(arg - TILT);
  float rad = 1.12 * RO + 0.015 * RO * sin(3.0 * arg + 0.5 * w);
  return exp(-sq((r - rad) / max(0.035 * RO, px)))
       * (0.35 + 0.65 * sq(max(k, 0.0))) * (0.8 + 0.2 * sin(4.0 * arg - 1.3 * t));
}

float tangentSlot(float dx, float dy) {
  float s = mod(degrees(atan(-dy, dx)), 180.0);
  if (s < 22.5 || s >= 157.5) return uGlyph[0];
  if (s < 67.5) return uGlyph[1];
  if (s < 112.5) return uGlyph[2];
  return uGlyph[3];
}

void scene(vec2 p, vec2 cell, out vec4 color) {
  float t = uT;
  float px = 1.0 / uRes.y;
  float cam = sm((t - FLASH + 0.3) / 2.6);
  vec2 P = p / (1.0 - 0.28 * cam);
  float tilt = INC * 0.99 * cam;
  float r = length(P);
  float arg = atan(P.y, P.x);
  float w = spinAt(t);
  float flash = exp(-sq((t - FLASH) / 0.22));

  float ringK = sm((t - 0.3) / 2.2);
  float arcEnd = mod(arg + PI * 0.5, TAU) / TAU;
  float ring = exp(-sq((r - 1.02 * RO) / max(0.045 * RO, px)))
             * sm((ringK - arcEnd) / 0.06);

  float diskOn = sm((t - 5.0) / 2.0);
  float auraK = sm((t - 2.2) / 1.0) * (1.0 - 0.85 * diskOn);
  vec3 rg = gasAt(arg - TILT, R_IN * max(r - RO, 0.0) * 2.6 + 0.002, t, w);
  float puff = 0.5 + 0.5 * rippleAt(3.0 * arg, 5.0 * r - 0.45 * t, 0.35 * w);
  puff = puff * (1.0 - diskOn) + rg.x * diskOn;
  float reach = 0.32 * RO * (0.7 + 0.6 * puff);
  float aura = auraK * exp(-pow(max(r - RO, 0.0) / reach, 1.6)) * (0.6 + 0.4 * puff);

  vec4 ad = diskAt(P, t, w, tilt);
  float disk = ad.x;
  float span = RO + diskOn * (R_OUT * 1.1 - RO);
  disk *= sm((span - r) / 0.1) * sm((r - 0.92 * RO) / (0.25 * RO))
        * (0.55 + 0.45 * sm((t - FLASH + 0.3) / 0.4));
  float halo = haloAt(r, arg, t, w, px * 0.8) * sm((t - 9.0) / 2.2);

  float soft = 1.0 - (1.0 - clamp(aura * 0.4, 0.0, 1.0)) * (1.0 - clamp(halo, 0.0, 1.0))
             * (1.0 - clamp(disk, 0.0, 1.0));
  soft = max(soft, max(disk, halo));
  float heat = max(ring * (0.9 + 0.5 * sm((t - 3.0) / 2.0)), soft) * 1.8 * (1.0 + 1.4 * flash);

  bool inside = r < RO * 0.97;
  if (inside) heat = ad.y > 0.0 && disk > 0.2 ? disk : 0.0;

  bool on = heat > 0.02;
  float slot = slotOf(heat, trunc(ad.z * 2.0 + ad.w * 6.0));
  if (ring > aura * 0.8 && ring > disk && ring > halo && ring > 0.35) {
    slot = tangentSlot(-sin(arg), cos(arg));
  }
  if (!on) slot = 0.0;

  vec3 tag = heat < 0.1 ? DEEP : heat < 0.2 ? RED : heat < 0.45 ? ORANGE
           : heat < 0.75 ? AMBER : HOT;
  float lum = on ? clamp(0.42 + 0.85 * heat, 0.0, 1.0)
                 * (0.35 + 0.65 * sm((heat - 0.07) / 0.15)) : 0.0;

  float red = hash21(cell + 0.37);
  if (!on && !inside && red < 0.0012) {
    slot = red < 0.0005 ? uGlyph[4] : red < 0.0012 ? uGlyph[5] : uGlyph[6];
    tag = STAR;
    lum = 0.75 + 0.2 * sin(0.6 * t + red * 9000.0);
  }

  color = vec4(tag * lum, slot / 255.0);
}
`;

const JELLY = `
void scene(vec2 p, vec2 cell, out vec4 color) {
  float t = uT;
  vec2 c = vec2(0.0, 0.05 + 0.04 * sin(t * 0.7));
  vec2 q = p - c;
  float ang = atan(q.y, q.x);
  float ruffle = 0.14 + 0.008 * sin(ang * 9.0 + t * 2.0);
  float d = length(q);
  float bell = smoothstep(0.014, 0.0, abs(d - ruffle)) * step(q.y, 0.02);
  float skin = smoothstep(ruffle, 0.0, d) * step(q.y, 0.02) * 0.45;
  float tents = 0.0;
  for (int i = 0; i < 7; i++) {
    float x0 = -0.105 + float(i) * 0.035 + 0.018 * sin(t * 0.8 + float(i) * 1.7);
    float bend = 0.5 * sin(q.y * 9.0 + t * 1.4 + float(i) * 0.9);
    float line = smoothstep(0.006, 0.0, abs(q.x - x0 - bend * q.y * 0.35));
    tents += line * smoothstep(-0.01, 0.06, q.y) * smoothstep(0.46, 0.12, q.y);
  }
  float pulse = 0.75 + 0.25 * sin(t * 1.1);
  float heat = max(bell, max(skin * pulse, tents * 0.75));
  heat *= 0.85 + 0.15 * sin(t * 0.5 + d * 12.0);
  color = emit(heat, uAccent, hash21(cell) * 12.0);
}
`;



const FISH = `
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void scene(vec2 p, vec2 cell, out vec4 color) {
  float t = uT;
  float heat = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float dir = (i == 1 || i == 2) ? -1.0 : 1.0;
    float depth = 0.75 + 0.18 * fi;
    float span = uAspect + 0.7;
    float travel = mod(t * (0.035 + 0.012 * fi) + fi * 0.29, 1.0);
    float x = (dir > 0.0 ? travel : 1.0 - travel) * span - span * 0.5;
    float y = 0.3 * sin(fi * 1.9 + 0.6) + 0.03 * sin(t * 1.1 + fi * 2.0);
    vec2 d = (p - vec2(x, y)) / depth;
    d.x *= dir;
    d.y -= 0.014 * sin(d.x * 26.0 - t * 7.0 + fi) * sm((0.06 - d.x) * 14.0);
    float body = (length(d / vec2(0.115, 0.068)) - 1.0) * 0.068;
    float outline = smoothstep(0.009, 0.0, abs(body));
    float fill = sm(-body * 26.0) * 0.5;
    vec2 root = vec2(-0.095, 0.0);
    float tail = min(segDist(d, root, vec2(-0.215, 0.062)), segDist(d, root, vec2(-0.215, -0.062)));
    float tailLine = smoothstep(0.012, 0.0, tail);
    float eye = smoothstep(0.011, 0.0, length(d - vec2(0.062, -0.008)));
    float f = max(outline, max(fill, max(tailLine * 0.85, eye)));
    heat = max(heat, f * (0.55 + 0.45 * depth));
  }
  color = emit(heat, uAccent, hash21(cell) * 12.0);
}
`;

const SCULPT = (map: string) => PRELUDE + `
const vec3 LIGHT = normalize(vec3(0.72, -0.58, 0.38));

vec2 rot2(vec2 v, float a) {
  float s = sin(a);
  float c = cos(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

${map}

vec3 normalAt(vec3 q) {
  float e = 0.004;
  return normalize(vec3(
    map(q + vec3(e, 0.0, 0.0)) - map(q - vec3(e, 0.0, 0.0)),
    map(q + vec3(0.0, e, 0.0)) - map(q - vec3(0.0, e, 0.0)),
    map(q + vec3(0.0, 0.0, e)) - map(q - vec3(0.0, 0.0, e))));
}

void scene(vec2 p, vec2 cell, out vec4 color) {
  vec3 ro = vec3(0.0, 0.0, 1.35);
  vec3 rd = normalize(vec3(p * 1.45, -1.6));
  float dist = 0.0;
  float hit = -1.0;
  for (int i = 0; i < 84; i++) {
    float s = map(ro + rd * dist);
    if (s < 0.0012) { hit = dist; break; }
    dist += max(s * 0.8, 0.0012);
    if (dist > 3.0) break;
  }
  float heat = 0.0;
  if (hit > 0.0) {
    vec3 pos = ro + rd * hit;
    vec3 n = normalAt(pos);
    float lambert = max(dot(n, LIGHT), 0.0);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.0);
    float spec = pow(max(dot(reflect(rd, n), LIGHT), 0.0), 18.0);
    float occ = 0.0;
    for (int i = 0; i < 3; i++) {
      float step = 0.03 + 0.045 * float(i);
      occ += (step - map(pos + n * step)) / step;
    }
    float ao = clamp(1.0 - occ / 3.0, 0.0, 1.0);
    heat = (0.1 + 0.6 * lambert + 0.5 * rim + 0.35 * spec) * (0.5 + 0.5 * ao);
  }
  color = emit(heat, uAccent, hash21(cell) * 12.0);
}
` + MAIN;

const TORUS = SCULPT(`
float map(vec3 q) {
  q.xz = rot2(q.xz, uT * 0.6);
  q.yz = rot2(q.yz, 1.15 + 0.15 * sin(uT * 0.3));
  vec2 w = vec2(length(q.xz) - 0.24, q.y);
  return length(w) - 0.095;
}
`);

const CRYSTAL = SCULPT(`
float map(vec3 q) {
  q.xz = rot2(q.xz, uT * 0.45);
  q.xy = rot2(q.xy, 0.4 * sin(uT * 0.3));
  q.y *= 1.25;
  vec3 p = abs(q);
  float octa = (p.x + p.y + p.z - 0.42) * 0.57735027;
  vec3 r = abs(q.zxy);
  float cube = max(max(r.x, r.y), r.z) - 0.19;
  return max(octa, -cube);
}
`);

const MOBIUS = SCULPT(`
float map(vec3 q) {
  q.xz = rot2(q.xz, uT * 0.35);
  q.yz = rot2(q.yz, 0.5);
  float angle = atan(q.z, q.x);
  float radius = length(q.xz);
  vec2 band = rot2(vec2(radius - 0.26, q.y), angle * 0.5);
  return max(abs(band.x) - 0.085, abs(band.y) - 0.016) - 0.006;
}
`);

const LATTICE = SCULPT(`
float map(vec3 q) {
  q.xz = rot2(q.xz, uT * 0.2);
  q.xy = rot2(q.xy, uT * 0.12);
  vec3 k = q * 7.0;
  float lattice = abs(dot(sin(k), cos(k.zxy))) - 0.32;
  float ball = length(q) - 0.42;
  return max(lattice * 0.16, ball * 0.9);
}
`);

const BLOB = SCULPT(`
float map(vec3 q) {
  q.xz = rot2(q.xz, uT * 0.25);
  vec3 a = q - vec3(0.15 * sin(uT * 0.7), 0.13 * cos(uT * 0.9), 0.0);
  vec3 b = q - vec3(-0.16 * cos(uT * 0.6), -0.11 * sin(uT * 0.8), 0.07);
  vec3 c = q - vec3(0.04 * sin(uT * 1.1), 0.17 * sin(uT * 0.5), -0.10);
  float d = length(a) - 0.18;
  d = smin(d, length(b) - 0.16, 0.10);
  return smin(d, length(c) - 0.13, 0.10);
}
`);


const STARS = `
void scene(vec2 p, vec2 cell, out vec4 color) {
  float t = uT;
  float heat = 0.0;
  float pick = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float density = 34.0 + fi * 26.0;
    vec2 g = p * density + vec2(t * (0.06 + 0.05 * fi), 0.0);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash21(id + fi * 37.0);
    float twinkle = 0.55 + 0.45 * sin(t * (0.7 + h * 0.9) + h * 21.0);
    float star = step(0.986, h) * smoothstep(0.4, 0.05, length(f)) * twinkle * (1.0 - 0.18 * fi);
    if (star > heat) { heat = star; pick = h; }
  }
  float slot = heat > 0.75 ? uGlyph[4] : heat > 0.35 ? uGlyph[5] : uGlyph[6];
  color = emitSlot(heat * 0.85, mix(uInk, uAccent, 0.35), slot);
}
`;

const ASCII = (body: string) => PRELUDE + body + MAIN;


const ANGEL = SCULPT(`
float ball(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}
float stick(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
mat2 face(vec2 d) { return mat2(-d.y, d.x, d.x, d.y); }

float angelBody(vec3 p) {
  float hips = ball(p - vec3(0.0, 0.03, 0.0), vec3(0.105, 0.095, 0.075));
  float torso = ball(p - vec3(0.0, 0.19, 0.005), vec3(0.092, 0.14, 0.068));
  float chest = ball(p - vec3(0.0, 0.29, 0.015), vec3(0.095, 0.075, 0.072));
  float neck = stick(p, vec3(0.0, 0.345, 0.0), vec3(0.0, 0.40, 0.005), 0.033);
  float head = ball(p - vec3(0.0, 0.465, 0.01), vec3(0.058, 0.075, 0.062));
  float hair = ball(p - vec3(0.0, 0.49, -0.03), vec3(0.068, 0.082, 0.058));
  float braid = stick(p, vec3(0.0, 0.45, -0.055), vec3(0.025, 0.12, -0.075), 0.032);
  float armUp = stick(p, vec3(-0.085, 0.29, 0.01), vec3(-0.15, 0.47, 0.06), 0.026);
  float armDown = stick(p, vec3(0.085, 0.29, 0.01), vec3(0.125, 0.08, 0.04), 0.026);

  float fall = clamp((0.03 - p.y) / 0.63, 0.0, 1.0);
  vec2 hem = vec2(p.x - 0.05 * fall * fall, p.z);
  float skirt = length(hem) - mix(0.085, 0.30, fall * fall);
  skirt += 0.028 * sin(atan(p.z, p.x) * 5.0 + p.y * 6.0) * fall;
  skirt = max(skirt, p.y - 0.06);
  skirt = max(skirt, -(p.y + 0.60));

  vec3 drape = p - vec3(0.02, 0.24, -0.075);
  drape.xy = rot2(drape.xy, 0.25);
  float cape = ball(drape, vec3(0.135, 0.28, 0.018));

  float body = min(min(hips, torso), min(chest, min(neck, min(head, hair))));
  body = min(body, min(braid, min(skirt, cape)));
  return min(body, min(armUp, armDown));
}

float angelWing(vec3 p) {
  vec3 w = p;
  w.x = abs(w.x);
  float edge = min(stick(w, vec3(0.05, 0.33, -0.10), vec3(0.24, 0.62, -0.12), 0.031),
              min(stick(w, vec3(0.24, 0.62, -0.12), vec3(0.44, 0.79, -0.13), 0.023),
                  stick(w, vec3(0.44, 0.79, -0.13), vec3(0.60, 0.87, -0.14), 0.015)));
  float feathers = 1e9;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float t = fi / 5.0;
    vec2 root = mix(vec2(0.09, 0.42), vec2(0.57, 0.80), t);
    float ang = 0.16 + 0.135 * fi;
    vec2 dir = vec2(sin(ang), -cos(ang));
    float len = 0.44 - 0.030 * fi;
    vec3 q = vec3(w.x, w.y, w.z + 0.11 + 0.02 * fi) - vec3(root + dir * (len * 0.5), 0.0);
    q.xy = face(dir) * q.xy;
    q.yz = rot2(q.yz, -0.10);
    feathers = min(feathers, ball(q, vec3(0.036, len * 0.5, 0.011)));
  }
  float coverts = 1e9;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 root = mix(vec2(0.08, 0.40), vec2(0.36, 0.62), fi * 0.5);
    vec2 dir = normalize(vec2(0.10 + 0.12 * fi, -1.0));
    vec3 q = vec3(w.x, w.y, w.z + 0.06) - vec3(root + dir * 0.14, 0.0);
    q.xy = face(dir) * q.xy;
    coverts = min(coverts, ball(q, vec3(0.040, 0.17, 0.012)));
  }
  return min(edge, min(feathers, coverts));
}

float angelProp(vec3 p) {
  float staff = stick(p, vec3(-0.16, -0.44, 0.06), vec3(-0.30, 0.60, 0.02), 0.009);
  float guard = ball(p - vec3(-0.275, 0.485, 0.03), vec3(0.028, 0.010, 0.010));
  vec2 ring = vec2(length(p.xy - vec2(0.0, 0.575)) - 0.082, p.z + 0.075);
  float halo = length(ring) - 0.006;
  vec3 rock = p - vec3(0.02, -0.645, 0.0);
  float base = ball(rock, vec3(0.245, 0.062, 0.175));
  base += 0.012 * sin(rock.x * 26.0) * sin(rock.z * 21.0);
  return min(min(staff, guard), min(halo, base));
}

float map(vec3 q) {
  q.y = -q.y;
  q *= 1.75;
  q.xz = rot2(q.xz, -0.5 + uScroll * 1.9 + uT * 0.25);
  q.y -= 0.16;
  return min(min(angelBody(q), angelWing(q)), angelProp(q)) / 1.75;
}
`);

const GYRO = SCULPT(`
float hoop(vec3 p, float yaw, float tilt, float radius, float thick) {
  p.yz = rot2(p.yz, tilt);
  p.xz = rot2(p.xz, yaw);
  vec2 q = vec2(length(p.xz) - radius, p.y);
  return length(q) - thick;
}

float map(vec3 q) {
  float t = uT * 0.5 + uScroll * 3.0;
  return min(hoop(q, t, 0.0, 0.24, 0.022),
         min(hoop(q, t * 1.3, 1.55, 0.30, 0.020),
             hoop(q, t * 0.7, 0.8, 0.36, 0.018)));
}
`);

export const ASCII_SCENES = {
  "ascii-blackhole": ASCII(BLACK_HOLE),
  "ascii-jelly": ASCII(JELLY),
  "ascii-fish": ASCII(FISH),
  "ascii-torus": TORUS,
  "ascii-crystal": CRYSTAL,
  "ascii-mobius": MOBIUS,
  "ascii-lattice": LATTICE,
  "ascii-blob": BLOB,
  "ascii-stars": ASCII(STARS),
  "ascii-angel": ANGEL,
  "ascii-gyro": GYRO,
};

export type AsciiSceneId = keyof typeof ASCII_SCENES;

export const LINES = `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec2 uRes;
uniform float uT;
uniform int uKind;
uniform vec2 uCursor;
uniform float uPower;
uniform float uGap;
uniform float uSpan;
uniform vec3 uInk;
uniform vec3 uAccent;
out vec4 outColor;

const float TAU = 6.28318531;

float sq(float x) { return x * x; }

float waveY(float x, float base, float index, float t, float span) {
  float nx = x / span;
  return base + sin(nx * 5.5 + t * 0.4 + index * 0.25) * 9.0
              + sin(nx * 11.0 - t * 0.25 + index * 0.1) * 4.0
              + sin(nx * 2.2 - t * 0.18) * 7.0;
}

float shapeY(float x, float base, float index, float t, float span) {
  float y = waveY(x, base, index, t, span);
  if (uPower < 0.01) return y;
  float dx = x - uCursor.x;
  float dy = y - uCursor.y;
  if (uKind == 2) {
    float dist = sqrt(dx * dx + dy * dy);
    return y + sin(dist * 0.075 - t * 3.1) * 15.0 * exp(-dist / 230.0) * uPower;
  }
  if (uKind == 4) {
    float crease = fract(t * 0.055) * (uRes.x + 400.0) - 200.0;
    float fade = exp(-sq((base - uCursor.y) / 260.0)) * uPower;
    y += tanh((x - crease) / 30.0) * 46.0 * fade;
    return y - dy * exp(-(dx * dx + dy * dy) / 90000.0) * 0.25 * uPower;
  }
  if (uKind == 5) {
    float dist = max(sqrt(dx * dx + dy * dy), 1.0);
    float ang = (0.8 + sin(t * 0.5) * 0.35) * exp(-dist / 260.0) * uPower;
    return uCursor.y + dx * sin(ang) + dy * cos(ang);
  }
  if (dx * dx + dy * dy > 22500.0) return y;
  float q = sqrt(dx * dx + dy * dy) / 150.0;
  float strength = (1.0 - q * q) * (1.0 - q * q) * uPower;
  if (uKind == 1) return y + tanh(dy / 30.0) * strength * 38.0;
  y -= dy * strength * 0.8;
  return y + sin(q * 9.0 - t * 2.6) * 4.0 * strength;
}

void main() {
  vec2 px = vUV * uRes;
  vec2 cursor = uCursor;
  float t = uT;
  float gap = uGap;
  float span = uSpan;
  if (uKind == 3) {
    float size = length(uRes);
    vec2 centre = uRes * 0.5;
    float c = 0.70710678;
    vec2 local = vec2(
      size * 0.5 + (px.x - centre.x) * c - (px.y - centre.y) * c,
      size * 0.5 + (px.x - centre.x) * c + (px.y - centre.y) * c);
    px = local;
    cursor = vec2(
      size * 0.5 + (uCursor.x - centre.x) * c - (uCursor.y - centre.y) * c,
      size * 0.5 + (uCursor.x - centre.x) * c + (uCursor.y - centre.y) * c);
    gap = uGap * 1.5;
    span = size;
  }

  float index0 = floor(px.y / gap) + 1.0;
  float best = 1e9;
  float bestIndex = index0;
  for (int j = -1; j <= 1; j++) {
    float index = index0 + float(j);
    float base = (index - 1.0) * gap;
    float y = shapeY(px.x, base, index, t, span);
    float d = abs(px.y - y);
    if (d < best) { best = d; bestIndex = index; }
  }

  float cover = smoothstep(1.4, 0.2, best);
  float hi = step(mod(bestIndex, 9.0), 0.5);
  float alpha = (hi > 0.5 ? 0.45 : 0.13) * cover;
  vec3 col = mix(uInk, uAccent, hi);

  if (uKind == 7) {
    vec2 d = px - cursor;
    float ring = smoothstep(320.0, 40.0, length(d)) * uPower * cover;
    alpha = ring * 0.75;
    col = uAccent;
  } else {
    float base = (bestIndex - 1.0) * gap;
    float near = exp(-sq((base - cursor.y) / 141.0)) * uPower;
    float halo = near * 0.75 * cover * exp(-sq((px.x - cursor.x) / 240.0));
    alpha = max(alpha, halo);
    col = mix(col, uAccent, clamp(halo * 1.5, 0.0, 1.0));
  }

  outColor = vec4(col * alpha, alpha);
}
`;

export type GpuScene =
  | { mode: "ascii"; label: string; hint: string; menu: string }
  | { mode: "lines"; kind: number; gap: number; label: string; hint: string; menu: string };

export const GPU_SCENES = {
  "ascii-blackhole": { mode: "ascii", label: "Black hole", hint: "ascii", menu: "ASCII · black hole" },
  "ascii-jelly": { mode: "ascii", label: "Jellyfish", hint: "ascii", menu: "ASCII · jellyfish" },
  "ascii-fish": { mode: "ascii", label: "Fish", hint: "ascii", menu: "ASCII · fish" },
  "ascii-torus": { mode: "ascii", label: "Torus", hint: "ascii", menu: "ASCII · torus" },
  "ascii-crystal": { mode: "ascii", label: "Crystal", hint: "ascii", menu: "ASCII · crystal" },
  "ascii-mobius": { mode: "ascii", label: "Möbius", hint: "ascii", menu: "ASCII · möbius" },
  "ascii-lattice": { mode: "ascii", label: "Lattice", hint: "ascii", menu: "ASCII · lattice" },
  "ascii-blob": { mode: "ascii", label: "Blob", hint: "ascii", menu: "ASCII · blob" },
  "ascii-stars": { mode: "ascii", label: "Stars", hint: "ascii", menu: "ASCII · stars" },
  "ascii-angel": { mode: "ascii", label: "Guardian", hint: "ascii", menu: "ASCII · winged guardian" },
  "ascii-gyro": { mode: "ascii", label: "Gyroscope", hint: "ascii", menu: "ASCII · gyroscope" },
  "gpu-magnetic": { mode: "lines", kind: 0, gap: 24, label: "Magnetic", hint: "gpu", menu: "GPU · magnetic" },
  "gpu-split": { mode: "lines", kind: 1, gap: 24, label: "Split", hint: "gpu", menu: "GPU · split" },
  "gpu-ripple": { mode: "lines", kind: 2, gap: 24, label: "Ripple", hint: "gpu", menu: "GPU · ripple" },
  "gpu-diagonal": { mode: "lines", kind: 3, gap: 24, label: "Diagonal", hint: "gpu", menu: "GPU · diagonal" },
  "gpu-fold": { mode: "lines", kind: 4, gap: 24, label: "Fold", hint: "gpu", menu: "GPU · fold" },
  "gpu-spiral": { mode: "lines", kind: 5, gap: 24, label: "Spiral", hint: "gpu", menu: "GPU · spiral" },
  "gpu-sheen": { mode: "lines", kind: 6, gap: 24, label: "Sheen", hint: "gpu", menu: "GPU · sheen" },
  "gpu-spotlight": { mode: "lines", kind: 7, gap: 26, label: "Spotlight", hint: "gpu", menu: "GPU · spotlight" },
} satisfies Record<string, GpuScene>;

export type GpuVariant = keyof typeof GPU_SCENES;
export const GPU_VARIANTS = Object.keys(GPU_SCENES) as GpuVariant[];

export const isGpuVariant = (value: string): value is GpuVariant => value in GPU_SCENES;
