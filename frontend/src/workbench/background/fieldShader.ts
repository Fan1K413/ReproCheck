/**
 * ReproCheck 背景着色器（WebGL1 / GLSL ES 1.00，兼容 WebGL2）。
 *
 * 支持双主题实时驱动：
 * - 深色模式（uIsLight = 0.0）：中性石墨底与哑光香槟金珀域扭曲丝绸褶皱；
 * - 浅色模式（uIsLight = 1.0）：仿 Anthropic 暖米色手工纸肌理与柔和日光水纹。
 */

export const MAX_LOBES = 6

export const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

export const FRAGMENT_SHADER = `
precision mediump float;

#define MAX_LOBES ${MAX_LOBES}

uniform vec2 uResolution;
uniform vec4 uBackground;
uniform int uCount;
uniform vec3 uBlobs[MAX_LOBES];
uniform vec4 uColors[MAX_LOBES];
uniform float uSoftness;
uniform float uTime;
uniform vec3 uSilkDeep;
uniform vec3 uSilkLight;
uniform vec3 uAmbientLow;
uniform vec3 uAmbientHigh;
uniform vec3 uFiberColor;
uniform vec3 uRidgeColor;
uniform vec3 uVignetteColor;
uniform float uIsLight;

varying vec2 vUv;

float hash21(vec2 point) {
  vec3 p3 = fract(vec3(point.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  vec2 curve = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, curve.x), mix(c, d, curve.x), curve.y);
}

float fbm(vec2 point) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 turn = mat2(0.7986, 0.6018, -0.6018, 0.7986);
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * valueNoise(point);
    point = turn * point * 2.03 + vec2(1.7, 9.2);
    amplitude *= 0.5;
  }
  return value;
}

mat2 rotate2d(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c);
}

void main() {
  vec2 aspect = uResolution / max(uResolution.x, uResolution.y);
  vec2 point = (vUv - 0.5) * aspect;

  vec3 lightTint = vec3(0.0);
  float lightWeight = 0.0;
  for (int index = 0; index < MAX_LOBES; index++) {
    if (index >= uCount) break;
    vec2 center = uBlobs[index].xy * aspect;
    float radius = max(uBlobs[index].z, 0.04) + uSoftness;
    float distanceToLight = length(point - center) / radius;
    float weight = exp(-2.6 * distanceToLight * distanceToLight) * uColors[index].a;
    lightTint += uColors[index].rgb * weight;
    lightWeight += weight;
  }
  vec3 lightColor = lightTint / max(lightWeight, 0.0001);
  float light = clamp(lightWeight * 0.42, 0.0, 1.0);

  float time = uTime;
  vec2 q = rotate2d(-0.46) * point;
  q.x *= 2.05;
  q.y *= 0.86;

  vec2 warp = vec2(
    fbm(q * 2.15 + vec2(0.0, time * 0.032)),
    fbm(q * 2.15 + vec2(4.7, -time * 0.025))
  );
  vec2 folded = q + (warp - 0.5) * 0.62;

  float broad = fbm(folded * 2.9 + vec2(time * 0.016, 0.0));
  float ridge = pow(clamp(1.0 - abs(broad * 2.0 - 1.0), 0.0, 1.0), 2.6);

  float macro = fbm(folded * 1.05 + vec2(-time * 0.010, time * 0.006));
  float macroRidge = pow(clamp(1.0 - abs(macro * 2.0 - 1.0), 0.0, 1.0), 1.9);

  float fiberField = fbm(folded * 7.2 - vec2(0.0, time * 0.040));
  float fiber = smoothstep(0.64, 0.98, fiberField);

  float veil = fbm(point * 2.3 + vec2(-time * 0.012, time * 0.009));
  float calm = mix(0.4, 1.0, smoothstep(0.085, 0.34, length(point)));

  float silk = clamp(macroRidge * 0.4 + ridge * 0.4 + fiber * 0.2, 0.0, 1.0);
  vec3 silkLightMix = mix(uSilkLight, lightColor, 0.3);
  vec3 silkColor = mix(uSilkDeep, silkLightMix, clamp(ridge * 0.7 + macroRidge * 0.18 + light * 0.2, 0.0, 1.0));

  float drift = smoothstep(-0.55, 0.55, point.x * 0.9 - point.y * 0.32);
  float vignette = smoothstep(0.16, 0.86, length(point * vec2(0.92, 1.18)));

  vec3 color;
  if (uIsLight > 0.5) {
    /* 浅色类纸模式：温润棉纸底色 + 细腻暖沙折纹 + 极淡陶土日光晕 */
    vec3 paperBase = mix(uAmbientLow, uAmbientHigh, drift * 0.75 + veil * 0.25);
    vec3 foldShade = mix(paperBase, uSilkDeep, silk * 0.28 * calm);
    vec3 warmWash = mix(foldShade, uSilkLight, light * 0.14 * calm);
    warmWash = mix(warmWash, uFiberColor, fiber * light * 0.05 * calm);
    warmWash = mix(warmWash, uRidgeColor, pow(ridge, 4.0) * 0.18 * calm);
    color = mix(warmWash, uVignetteColor, vignette * 0.36);
  } else {
    /* 深色石墨金珀模式：纯净中性石墨底 + 极克制香槟金珀丝绸脊线 */
    vec3 ambient = mix(uAmbientLow, uAmbientHigh, drift);
    ambient += lightColor * light * 0.08;
    vec3 base = uBackground.rgb + ambient * (0.78 + veil * 0.42);

    color = base * (0.72 + 0.50 * silk) + silkColor * silk * (0.065 + light * 0.28) * calm;
    color += uFiberColor * fiber * light * 0.065 * calm;
    color += uRidgeColor * pow(ridge, 5.0) * light * 0.095 * calm;
    color = mix(color, uVignetteColor, vignette * 0.46);
  }

  float grain = hash21(gl_FragCoord.xy + 13.7) - 0.5;
  color += grain * (uIsLight > 0.5 ? 0.011 : 0.0065);

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), uBackground.a);
}
`
