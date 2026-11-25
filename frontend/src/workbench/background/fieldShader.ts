/**
 * ReproCheck 背景着色器（WebGL1 / GLSL ES 1.00，兼容 WebGL2）。
 *
 * 第二轮重构：不再用「大高斯光斑」铺满画面，而是把低频光斑降级为
 * 「环境光位置」，真正的空间质感由域扭曲（domain warping）产生的
 * 低对比丝绸褶皱承担。
 *
 * 技术来源与许可证：
 * - godwire / react-aurora-background（MIT）：把 fbm 反馈进采样坐标，
 *   得到被拉伸、折叠的连续绸带；本文件只保留其域扭曲结构。
 * - velvet（MIT）：旋转各向异性 fbm、ridge（脊线）与 fine fiber（细纤维）
 *   的叠层方式，用来形成织物般的明暗走向。
 * - paper-design / shaders（Apache-2.0）：仅借鉴「颗粒作为最后一道
 *   质感层」的思路，不复制其代码。
 *
 * 与旧实现的兼容点：uBlobs / uColors / uSoftness 接口保持不变，
 * controller 只新增一个 uTime；画面比例、DPR 与 30fps 生命周期不变。
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

varying vec2 vUv;

/* 值噪声：比 simplex 便宜，低分辨率缓冲放大后足够柔和。 */
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

/* 四层 fbm，每层旋转 37°，避免噪声出现网格轴向。 */
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
  // 位置按长边归一化：竖屏与横屏的褶皱尺度一致，不会被拉成面条。
  vec2 aspect = uResolution / max(uResolution.x, uResolution.y);
  vec2 point = (vUv - 0.5) * aspect;

  /*
   * 环境光：只保留「哪里更亮」的低频信息，不再直接把颜色铺成光斑。
   * 每个 lobe 的权重写入 uColors.a，颜色作为丝绸的冷暖偏移。
   */
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

  /*
   * 丝绸：斜向拉伸的域扭曲。
   * 第一层 warp 把坐标折弯，第二层在折弯后的坐标上取脊线；
   * q.x 被拉长、q.y 被压扁，褶皱因此呈现长条绸带，而不是圆形云团。
   */
  float time = uTime;
  vec2 q = rotate2d(-0.46) * point;
  q.x *= 2.05;
  q.y *= 0.86;

  vec2 warp = vec2(
    fbm(q * 2.15 + vec2(0.0, time * 0.035)),
    fbm(q * 2.15 + vec2(4.7, -time * 0.028))
  );
  vec2 folded = q + (warp - 0.5) * 0.62;

  float broad = fbm(folded * 2.9 + vec2(time * 0.018, 0.0));
  float ridge = pow(clamp(1.0 - abs(broad * 2.0 - 1.0), 0.0, 1.0), 2.6);

  /* 更慢、更大尺度的底层褶：让画面有「整匹布」的走向，而不是局部云团。 */
  float macro = fbm(folded * 1.05 + vec2(-time * 0.011, time * 0.006));
  float macroRidge = pow(clamp(1.0 - abs(macro * 2.0 - 1.0), 0.0, 1.0), 1.9);

  float fiberField = fbm(folded * 7.2 - vec2(0.0, time * 0.045));
  float fiber = smoothstep(0.64, 0.98, fiberField);

  float veil = fbm(point * 2.3 + vec2(-time * 0.012, time * 0.009));

  /* 盘面区域压平：纹理仍在，但振幅降到 40%，保证图标与文字不被噪点穿过。 */
  float calm = mix(0.4, 1.0, smoothstep(0.085, 0.34, length(point)));

  float silk = clamp(macroRidge * 0.4 + ridge * 0.4 + fiber * 0.2, 0.0, 1.0);
  vec3 silkDeep = vec3(0.15, 0.045, 0.29);
  vec3 silkLight = mix(vec3(0.5, 0.2, 0.86), lightColor, 0.3);
  vec3 silkColor = mix(silkDeep, silkLight, clamp(ridge * 0.7 + macroRidge * 0.18 + light * 0.2, 0.0, 1.0));

  /*
   * 不是均匀紫雾：左下沉到墨黑，右上保留环境紫。
   * 这样丝绸的亮部才有「从暗处被一束光擦亮」的层次，而不是整片提亮。
   */
  float drift = smoothstep(-0.55, 0.55, point.x * 0.9 - point.y * 0.32);
  vec3 ambient = mix(vec3(0.016, 0.004, 0.032), vec3(0.068, 0.022, 0.118), drift);
  ambient += lightColor * light * 0.07;
  vec3 base = uBackground.rgb + ambient * (0.78 + veil * 0.42);

  /* 用丝绸值直接调制底色：亮褶抬起、暗褶压深，形成真正的绸面明暗。 */
  vec3 color = base * (0.7 + 0.52 * silk) + silkColor * silk * (0.06 + light * 0.26) * calm;
  color += vec3(0.42, 0.26, 0.58) * fiber * light * 0.07 * calm;

  /* 脊线上的极薄高光：只在高光位置出现，面积远小于旧光斑。 */
  color += vec3(0.5, 0.32, 0.72) * pow(ridge, 5.0) * light * 0.1 * calm;

  /* 四周收束：画面边缘沉入墨紫，中心保持可读。 */
  float vignette = smoothstep(0.14, 0.84, length(point * vec2(0.92, 1.18)));
  color *= mix(1.0, 0.56, vignette);

  /* 最后一道 0.6% 静态颗粒，消除深色渐变上的色阶带。 */
  float grain = hash21(gl_FragCoord.xy + 13.7) - 0.5;
  color += grain * 0.0065;

  gl_FragColor = vec4(max(color, vec3(0.0)), uBackground.a);
}
`
