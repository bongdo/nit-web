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

const BUTTERFLY = `
float ellipseDist(vec2 p, vec2 r) {
  return (length(p / r) - 1.0) * min(r.x, r.y);
}

float segmentDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void scene(vec2 p, vec2 cell, out vec4 color) {
  float t = uT;
  float flap = 0.35 + 0.65 * abs(sin(t * 1.5));
  vec2 q = vec2(abs(p.x), p.y);
  float upper = ellipseDist(q - vec2(0.12 * flap, -0.085), vec2(0.105 * flap, 0.082));
  float lower = ellipseDist(q - vec2(0.085 * flap, 0.075), vec2(0.072 * flap, 0.058));
  float wing = min(upper, lower);
  float aside = sm((q.x - 0.014) * 120.0);
  float outline = smoothstep(0.009, 0.0, abs(wing)) * aside;
  float fill = sm(-wing / 0.08) * 0.1 * aside;
  float spot = smoothstep(0.012, 0.0, abs(ellipseDist(q - vec2(0.15 * flap, -0.1), vec2(0.03, 0.026)))) * aside;
  float body = smoothstep(0.011, 0.0, abs(p.x)) * smoothstep(0.17, 0.04, abs(p.y)) * 0.95;
  float head = smoothstep(0.016, 0.0, length(p - vec2(0.0, -0.145)));
  float antenna = 0.0;
  for (int i = 0; i < 2; i++) {
    float side = i == 0 ? -1.0 : 1.0;
    antenna += smoothstep(0.005, 0.0,
      segmentDist(p, vec2(0.0, -0.15), vec2(side * 0.075, -0.245)));
  }
  float heat = max(outline, max(fill, max(spot * 0.8, max(body, max(head, antenna * 0.85)))));
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

const TORUS = `
float torusSdf(vec3 q) {
  q.xz = vec2(cos(uT * 0.6) * q.x - sin(uT * 0.6) * q.z, sin(uT * 0.6) * q.x + cos(uT * 0.6) * q.z);
  q.yz = vec2(0.9 * q.y - 0.42 * q.z, 0.42 * q.y + 0.9 * q.z);
  vec2 w = vec2(length(q.xz) - 0.24, q.y);
  return length(w) - 0.10;
}

vec3 torusNormal(vec3 p) {
  float e = 0.01;
  return normalize(vec3(
    torusSdf(p + vec3(e, 0.0, 0.0)) - torusSdf(p - vec3(e, 0.0, 0.0)),
    torusSdf(p + vec3(0.0, e, 0.0)) - torusSdf(p - vec3(0.0, e, 0.0)),
    torusSdf(p + vec3(0.0, 0.0, e)) - torusSdf(p - vec3(0.0, 0.0, e))));
}

void scene(vec2 p, vec2 cell, out vec4 color) {
  vec3 ro = vec3(0.0, 0.0, 1.2);
  vec3 rd = normalize(vec3(p * 2.6, -1.5));
  float dist = 0.0;
  float hit = -1.0;
  for (int i = 0; i < 64; i++) {
    float s = torusSdf(ro + rd * dist);
    if (s < 0.002) { hit = dist; break; }
    dist += s * 0.9;
    if (dist > 2.2) break;
  }
  float heat = 0.0;
  if (hit > 0.0) {
    vec3 pos = ro + rd * hit;
    vec3 n = torusNormal(pos);
    vec3 light = normalize(vec3(0.45, -0.65, -0.6));
    float lambert = max(dot(n, light), 0.0);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.5);
    float shine = pow(max(dot(reflect(rd, n), light), 0.0), 8.0);
    heat = 0.12 + 0.72 * pow(lambert, 0.85) + 0.45 * rim + 0.5 * shine;
  }
  color = emit(heat, uAccent, hash21(cell) * 12.0);
}
`;

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

export const ASCII_SCENES = {
  "ascii-blackhole": ASCII(BLACK_HOLE),
  "ascii-jelly": ASCII(JELLY),
  "ascii-butterfly": ASCII(BUTTERFLY),
  "ascii-fish": ASCII(FISH),
  "ascii-torus": ASCII(TORUS),
  "ascii-stars": ASCII(STARS),
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
  "ascii-butterfly": { mode: "ascii", label: "Butterfly", hint: "ascii", menu: "ASCII · butterfly" },
  "ascii-fish": { mode: "ascii", label: "Fish", hint: "ascii", menu: "ASCII · fish" },
  "ascii-torus": { mode: "ascii", label: "Torus", hint: "ascii", menu: "ASCII · torus" },
  "ascii-stars": { mode: "ascii", label: "Stars", hint: "ascii", menu: "ASCII · stars" },
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
