// biome-ignore-all lint/style/noMagicNumbers: shader tuning and GL constants
/**
 * WebGL layer that draws one sticker being peeled off (撕起来): a subdivided
 * quad whose vertices behind a moving fold line roll round a cylinder and
 * flip over, showing the white backing paper, with shading across the roll
 * and a soft shadow under the lifted part. Raw WebGL (2 when available, else
 * 1), no dependencies. The maths is in `peel-math.ts` (unit-tested); the
 * vertex shader here is the same mapping.
 *
 * Adapted from CatsJuice/sticker-forge (MIT, `lib/shaders.ts`: the cylinder
 * curl in `deformSticker` / `stickerSurfaceNormal` and the multi-tap alpha
 * shadow); see ATTRIBUTIONS.md.
 *
 * Draw order per frame (no depth buffer; the curl's height only grows as a
 * point lies further back along the direction, so painter's order by "along"
 * is exact):
 * 1. shadow of the curled part (MAX blend, so overlapping parts don't stack);
 * 2. the flat part, darkened where step 1 left shadow;
 * 3. the lift shadow of the whole sticker, slid underneath (MAX blend);
 * 4. the curled part, back to front.
 */

import {
  createGeometry,
  PERSPECTIVE_DISTANCE,
  type PeelGeometry,
  peelGeometry,
  type Size,
  silhouetteHull,
} from "./peel-math";

export type PeelFrame = {
  /** Screen-space (CSS px, viewport coords) rectangle where the sticker is drawn, before curl: centre, size, rotation. */
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Radians, clockwise on screen (CSS `rotate()`). */
  rotation: number;
  /** Grab point in the sticker's local unit square (0..1, 0..1; (0,0) top-left). The curl starts at the edge/corner nearest this point. */
  grabU: number;
  grabV: number;
  /** 0 = flat, 1 = fully peeled (the whole sticker lifted and rolled). */
  progress: number;
  /** Direction the curl travels (radians, screen space) — usually from the grab point toward the sticker centre, tilted by drag velocity. */
  direction: number;
  /** Extra lift for shadow (0..1). */
  lift: number;
};

export type PeelLayer = {
  /** Draws one frame. Cheap to call every rAF. */
  draw(frame: PeelFrame): void;
  /** Removes the canvas and frees GL resources. */
  destroy(): void;
  /** The silhouette hull the curl is shaped by (see `silhouetteHull`; empty: the whole rectangle). */
  readonly hull: Float32Array;
};

type GL = WebGLRenderingContext | WebGL2RenderingContext;

/** Quads per side of the sticker mesh. */
const GRID = 48;
const VERTS_PER_SIDE = GRID + 1;
const TRIANGLES = GRID * GRID * 2;
/** Buckets for sorting triangles back to front. */
const BUCKETS = 1024;
/** Largest texture side (the sticker is stretched to a power of two). */
const MAX_TEXTURE = 1024;
const MIN_TEXTURE = 64;
/** The silhouette hull is measured on a copy this small. */
const HULL_SIZE = 96;
const MAX_DPR = 2;
/** The shadow mesh reaches this far (share of the size) past the sticker so the blur isn't cut off. */
const SHADOW_MARGIN = 0.12;
/** Towards the light, screen space (x right, y down, z to the viewer): upper left. */
const LIGHT = { x: -0.4, y: -0.6, z: 1 };
/** Shadow slides this far (px per px of height) away from the light. */
const SHADOW_SLIDE_X = 0.34;
const SHADOW_SLIDE_Y = 0.52;
/** Height (px) that `lift` = 1 puts the whole sticker at, for its shadow. */
const LIFT_HEIGHT = 26;
const LIFT_OPACITY = 0.32;
const CURL_SHADOW_OPACITY = 0.42;
/** Blur (px) at height 0 and per px of height. */
const SHADOW_BLUR_BASE = 1.5;
const SHADOW_BLUR_PER_HEIGHT = 0.3;
/** Warm dark brown, like --shadow-float. */
const SHADOW_RGB = [0.19, 0.14, 0.07] as const;
/** The curl's shadow fades in over this share of the radius (none where the sheet still touches). */
const CURL_SHADOW_FADE = 0.4;
/** The lift shadow is there as soon as lift is. */
const LIFT_FADE = 1e-3;
const DEFAULT_Z_INDEX = 15;
/** Size changes smaller than this (px) don't re-sort the triangles. */
const SIZE_TOLERANCE = 0.5;
const RGBA = { stride: 4, channel: 3 };
/** Everything in front of this is flat (used when progress is 0). */
const NO_FOLD = -1e6;

const VERTEX_COMMON = /* glsl */ `
precision highp float;
attribute vec2 aUv;
uniform vec4 uFrame;    // centre x, centre y, width, height (CSS px)
uniform vec4 uAxes;     // cos(rotation), sin(rotation), curl direction x, y (local)
uniform vec4 uCurl;     // fold line, radius, max angle, camera distance
uniform vec2 uViewport; // CSS px

// Cylinder curl, after sticker-forge's deformSticker (MIT).
vec3 curl(vec2 p, out vec3 normal, out float angle) {
  vec2 d = uAxes.zw;
  float arc = uCurl.x - dot(p, d);
  normal = vec3(0.0, 0.0, 1.0);
  angle = 0.0;
  if (arc <= 0.0) return vec3(p, 0.0);
  float radius = max(uCurl.y, 0.001);
  float maxAngle = uCurl.z;
  angle = min(arc / radius, maxAngle);
  float projected = -radius * sin(angle);
  float elevation = radius * (1.0 - cos(angle));
  float freeLength = arc - radius * maxAngle;
  if (freeLength > 0.0) {
    projected -= freeLength * cos(maxAngle);
    elevation += freeLength * sin(maxAngle);
  }
  normal = vec3(d * sin(angle), cos(angle));
  return vec3(p + d * (arc + projected), elevation);
}

vec2 rotateToScreen(vec2 v) {
  return vec2(v.x * uAxes.x - v.y * uAxes.y, v.x * uAxes.y + v.y * uAxes.x);
}

vec4 clipFromScreen(vec2 s) {
  return vec4(s.x / uViewport.x * 2.0 - 1.0, 1.0 - s.y / uViewport.y * 2.0, 0.0, 1.0);
}
`;

const STICKER_VERTEX = /* glsl */ `${VERTEX_COMMON}
varying vec2 vUv;
varying vec3 vNormal;
varying float vAngle;

void main() {
  vUv = aUv;
  vec3 normal;
  float angle;
  vec3 q = curl((aUv - 0.5) * uFrame.zw, normal, angle);
  vNormal = vec3(rotateToScreen(normal.xy), normal.z);
  vAngle = angle;
  float scale = uCurl.w / max(uCurl.w - q.z, 1.0);
  gl_Position = clipFromScreen(uFrame.xy + rotateToScreen(q.xy) * scale);
}
`;

const STICKER_FRAGMENT = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTexture;
uniform vec3 uLight;
varying vec2 vUv;
varying vec3 vNormal;
varying float vAngle;

float grain(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 print = texture2D(uTexture, vUv); // premultiplied
  if (print.a < 0.004) discard;
  vec3 normal = normalize(vNormal);
  vec3 halfway = normalize(uLight + vec3(0.0, 0.0, 1.0));
  // 0 on the flat part, so the flat sticker matches the DOM one exactly.
  float curled = smoothstep(0.0, 0.35, vAngle);
  vec3 color;
  if (normal.z >= 0.0) {
    float lambert = dot(normal, uLight) / uLight.z;
    float shade = mix(1.0, clamp(0.42 + 0.58 * lambert, 0.35, 1.12), curled);
    float gloss = pow(max(dot(normal, halfway), 0.0), 28.0) * 0.22 * curled;
    color = print.rgb * shade + gloss * print.a;
  } else {
    // The backing paper: the same silhouette, off-white, lit across the roll.
    vec3 back = -normal;
    float lambert = max(dot(back, uLight), 0.0) / uLight.z;
    float edgeOn = 1.0 - abs(back.z);
    float shade = (0.64 + 0.36 * lambert) * (1.0 - 0.22 * edgeOn * (1.0 - min(lambert, 1.0)));
    float sheen = pow(max(dot(back, halfway), 0.0), 18.0) * 0.16;
    float fibre = (grain(floor(vUv * 640.0)) - 0.5) * 0.035;
    float wash = 0.985 + 0.03 * (vUv.x - vUv.y);
    vec3 paper = vec3(0.965, 0.945, 0.902) * shade * wash + fibre + sheen;
    color = paper * print.a;
  }
  gl_FragColor = vec4(color, print.a);
}
`;

const SHADOW_VERTEX = /* glsl */ `${VERTEX_COMMON}
uniform vec4 uShadow; // slide x, y per px of height, extra height, mesh margin
varying vec2 vUv;
varying float vHeight;

void main() {
  vec2 uv = (aUv - 0.5) * (1.0 + 2.0 * uShadow.w) + 0.5;
  vUv = uv;
  vec3 normal;
  float angle;
  vec3 q = curl((uv - 0.5) * uFrame.zw, normal, angle);
  float height = q.z + uShadow.z;
  vHeight = height;
  // Cast onto the desk (z = 0), so no perspective.
  gl_Position = clipFromScreen(uFrame.xy + rotateToScreen(q.xy) + uShadow.xy * height);
}
`;

const SHADOW_FRAGMENT = /* glsl */ `
precision mediump float;
uniform sampler2D uTexture;
uniform vec4 uLook;  // opacity, blur px at height 0, blur px per px of height, fade-in height
uniform vec2 uSize;  // sticker size, CSS px
uniform vec3 uColor;
varying vec2 vUv;
varying float vHeight;

float alphaAt(vec2 uv) {
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return texture2D(uTexture, uv).a * inside.x * inside.y;
}

// Multi-tap alpha blur, after sticker-forge's galleryShadowFragmentShader (MIT).
void main() {
  vec2 blur = (uLook.y + max(vHeight, 0.0) * uLook.z) / uSize;
  float alpha = alphaAt(vUv) * 0.16;
  alpha += alphaAt(vUv + vec2(blur.x, 0.0)) * 0.1;
  alpha += alphaAt(vUv - vec2(blur.x, 0.0)) * 0.1;
  alpha += alphaAt(vUv + vec2(0.0, blur.y)) * 0.1;
  alpha += alphaAt(vUv - vec2(0.0, blur.y)) * 0.1;
  alpha += alphaAt(vUv + blur) * 0.075;
  alpha += alphaAt(vUv - blur) * 0.075;
  alpha += alphaAt(vUv + vec2(blur.x, -blur.y)) * 0.075;
  alpha += alphaAt(vUv + vec2(-blur.x, blur.y)) * 0.075;
  vec2 wide = blur * 1.85;
  alpha += alphaAt(vUv + vec2(wide.x, 0.0)) * 0.0375;
  alpha += alphaAt(vUv - vec2(wide.x, 0.0)) * 0.0375;
  alpha += alphaAt(vUv + vec2(0.0, wide.y)) * 0.0375;
  alpha += alphaAt(vUv - vec2(0.0, wide.y)) * 0.0375;
  alpha *= uLook.x * smoothstep(0.0, uLook.w, vHeight);
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(uColor * alpha, alpha);
}
`;

const compile = (gl: GL, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const link = (gl: GL, vertexSource: string, fragmentSource: string) => {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!(vertex && fragment && program)) {
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aUv");
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
};

const uniforms = <K extends string>(
  gl: GL,
  program: WebGLProgram,
  names: readonly K[]
) => {
  const out = {} as Record<K, WebGLUniformLocation | null>;
  for (const name of names) {
    out[name] = gl.getUniformLocation(program, name);
  }
  return out;
};

const COMMON_UNIFORMS = ["uFrame", "uAxes", "uCurl", "uViewport"] as const;

const nextPowerOfTwo = (value: number) =>
  Math.min(
    MAX_TEXTURE,
    Math.max(MIN_TEXTURE, 2 ** Math.ceil(Math.log2(Math.max(value, 1))))
  );

const prefersReducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

const imageSize = (image: HTMLImageElement | ImageBitmap) =>
  "naturalWidth" in image
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : { width: image.width, height: image.height };

/** Draws the image stretched onto a size×size 2D canvas and reads it back. */
const rasterise = (image: HTMLImageElement | ImageBitmap, size: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return null;
  }
  context.drawImage(image, 0, 0, size, size);
  return context.getImageData(0, 0, size, size);
};

const createContext = (canvas: HTMLCanvasElement) => {
  const attributes: WebGLContextAttributes = {
    alpha: true,
    antialias: true,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  };
  const gl2 = canvas.getContext("webgl2", attributes);
  if (gl2) {
    return { gl: gl2 as GL, maxEquation: gl2.MAX as number | null };
  }
  const gl1 = canvas.getContext("webgl", attributes);
  if (!gl1) {
    return null;
  }
  const minmax = gl1.getExtension("EXT_blend_minmax");
  return { gl: gl1 as GL, maxEquation: minmax ? minmax.MAX_EXT : null };
};

/** Unit-square coordinates of the mesh vertices, row by row. */
const meshVertices = () => {
  const data = new Float32Array(VERTS_PER_SIDE * VERTS_PER_SIDE * 2);
  for (let row = 0; row <= GRID; row += 1) {
    for (let column = 0; column <= GRID; column += 1) {
      const i = (row * VERTS_PER_SIDE + column) * 2;
      data[i] = column / GRID;
      data[i + 1] = row / GRID;
    }
  }
  return data;
};

/** Triangle t's three vertex indices, in the mesh's own order (front faces counter-clockwise in clip space). */
const meshTriangles = () => {
  const data = new Uint16Array(TRIANGLES * 3);
  let t = 0;
  for (let row = 0; row < GRID; row += 1) {
    for (let column = 0; column < GRID; column += 1) {
      const a = row * VERTS_PER_SIDE + column;
      const b = a + 1;
      const c = a + VERTS_PER_SIDE;
      const d = c + 1;
      data.set([a, b, c, b, d, c], t * 6);
      t += 1;
    }
  }
  return data;
};

/** `gl.useProgram` (a WebGL call, not a React hook). */
const activate = (gl: GL, program: WebGLProgram) => {
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL, not a React hook
  gl.useProgram(program);
};

/** The sticker's pixels (power-of-two square) and its silhouette hull; null when the image can't be read. */
const readImage = async (image: HTMLImageElement | ImageBitmap) => {
  if ("decode" in image && !image.complete) {
    try {
      await image.decode();
    } catch {
      return null;
    }
  }
  const { width, height } = imageSize(image);
  if (!(width > 0 && height > 0)) {
    return null;
  }
  try {
    const pixels = rasterise(image, nextPowerOfTwo(Math.max(width, height)));
    const small = rasterise(image, HULL_SIZE);
    if (!pixels) {
      return null;
    }
    const hull = small
      ? silhouetteHull(small.data, HULL_SIZE, HULL_SIZE, RGBA)
      : new Float32Array(0);
    return { pixels, hull };
  } catch {
    return null; // tainted cross-origin image
  }
};

const uploadTexture = (gl: GL, texture: WebGLTexture, pixels: ImageData) => {
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
};

/** Programs, buffers and texture for one sticker; null (and the context released) if any part fails. */
const createResources = (gl: GL, pixels: ImageData) => {
  const stickerProgram = link(gl, STICKER_VERTEX, STICKER_FRAGMENT);
  const shadowProgram = link(gl, SHADOW_VERTEX, SHADOW_FRAGMENT);
  const vertexBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (
    !(stickerProgram && shadowProgram && vertexBuffer && indexBuffer && texture)
  ) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
  const vertices = meshVertices();
  const triangles = meshTriangles();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, triangles, gl.DYNAMIC_DRAW);
  uploadTexture(gl, texture, pixels);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);

  const stickerUniforms = uniforms(gl, stickerProgram, [
    ...COMMON_UNIFORMS,
    "uTexture",
    "uLight",
  ]);
  const shadowUniforms = uniforms(gl, shadowProgram, [
    ...COMMON_UNIFORMS,
    "uTexture",
    "uShadow",
    "uLook",
    "uSize",
    "uColor",
  ]);
  const lightLength = Math.hypot(LIGHT.x, LIGHT.y, LIGHT.z);
  activate(gl, stickerProgram);
  gl.uniform1i(stickerUniforms.uTexture, 0);
  gl.uniform3f(
    stickerUniforms.uLight,
    LIGHT.x / lightLength,
    LIGHT.y / lightLength,
    LIGHT.z / lightLength
  );
  activate(gl, shadowProgram);
  gl.uniform1i(shadowUniforms.uTexture, 0);
  gl.uniform3f(shadowUniforms.uColor, ...SHADOW_RGB);

  const free = () => {
    gl.deleteBuffer(vertexBuffer);
    gl.deleteBuffer(indexBuffer);
    gl.deleteTexture(texture);
    gl.deleteProgram(stickerProgram);
    gl.deleteProgram(shadowProgram);
  };
  return {
    stickerProgram,
    shadowProgram,
    stickerUniforms,
    shadowUniforms,
    vertices,
    triangles,
    free,
  };
};

/**
 * Keeps the index buffer sorted back to front: by each triangle's smallest
 * "along" (position along the curl direction), largest first, so the curl
 * (whose height only grows further back) paints over what lies under it.
 * Bucket sort into preallocated arrays; re-sorts only when the direction or
 * size changes.
 */
const createSorter = (
  gl: GL,
  vertices: Float32Array,
  triangles: Uint16Array
) => {
  const sorted = new Uint16Array(triangles.length);
  const along = new Float32Array(vertices.length / 2);
  const keys = new Float32Array(TRIANGLES);
  const bucketOf = new Uint16Array(TRIANGLES);
  const bucketStart = new Uint32Array(BUCKETS + 1);
  const cursor = new Uint32Array(BUCKETS);
  const last = { dirX: Number.NaN, dirY: Number.NaN, width: 0, height: 0 };
  const scale = { maxKey: 0, range: 1 };

  const computeKeys = (dirX: number, dirY: number, size: Size) => {
    for (let i = 0; i < along.length; i += 1) {
      along[i] =
        ((vertices[i * 2] ?? 0) - 0.5) * size.width * dirX +
        ((vertices[i * 2 + 1] ?? 0) - 0.5) * size.height * dirY;
    }
    let maxKey = Number.NEGATIVE_INFINITY;
    let minKey = Number.POSITIVE_INFINITY;
    for (let t = 0; t < TRIANGLES; t += 1) {
      const key = Math.min(
        along[triangles[t * 3] ?? 0] ?? 0,
        along[triangles[t * 3 + 1] ?? 0] ?? 0,
        along[triangles[t * 3 + 2] ?? 0] ?? 0
      );
      keys[t] = key;
      maxKey = Math.max(maxKey, key);
      minKey = Math.min(minKey, key);
    }
    scale.maxKey = maxKey;
    scale.range = Math.max(maxKey - minKey, 1e-6);
  };

  /** Counts triangles per bucket, then turns the counts into start offsets. */
  const countBuckets = () => {
    bucketStart.fill(0);
    for (let t = 0; t < TRIANGLES; t += 1) {
      const bucket = Math.min(
        BUCKETS - 1,
        Math.floor(
          ((scale.maxKey - (keys[t] ?? 0)) / scale.range) * (BUCKETS - 1)
        )
      );
      bucketOf[t] = bucket;
      bucketStart[bucket + 1] = (bucketStart[bucket + 1] ?? 0) + 1;
    }
    for (let b = 0; b < BUCKETS; b += 1) {
      bucketStart[b + 1] = (bucketStart[b + 1] ?? 0) + (bucketStart[b] ?? 0);
      cursor[b] = bucketStart[b] ?? 0;
    }
  };

  const bucketSort = () => {
    countBuckets();
    for (let t = 0; t < TRIANGLES; t += 1) {
      const bucket = bucketOf[t] ?? 0;
      const slot = cursor[bucket] ?? 0;
      cursor[bucket] = slot + 1;
      sorted[slot * 3] = triangles[t * 3] ?? 0;
      sorted[slot * 3 + 1] = triangles[t * 3 + 1] ?? 0;
      sorted[slot * 3 + 2] = triangles[t * 3 + 2] ?? 0;
    }
  };

  const update = (dirX: number, dirY: number, size: Size) => {
    const same =
      Math.abs(dirX - last.dirX) < 1e-4 &&
      Math.abs(dirY - last.dirY) < 1e-4 &&
      Math.abs(size.width - last.width) < SIZE_TOLERANCE &&
      Math.abs(size.height - last.height) < SIZE_TOLERANCE;
    if (same) {
      return;
    }
    last.dirX = dirX;
    last.dirY = dirY;
    last.width = size.width;
    last.height = size.height;
    computeKeys(dirX, dirY, size);
    bucketSort();
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, sorted);
  };

  /** How many of the sorted triangles lie wholly ahead of the fold (flat). */
  const flatCount = (front: number) => {
    const ahead = ((scale.maxKey - front) / scale.range) * (BUCKETS - 1);
    if (!(ahead < BUCKETS)) {
      return TRIANGLES;
    }
    return bucketStart[Math.max(0, Math.floor(ahead))] ?? 0;
  };

  return { update, flatCount };
};

type Resources = NonNullable<ReturnType<typeof createResources>>;
type CommonLocations = Record<
  (typeof COMMON_UNIFORMS)[number],
  WebGLUniformLocation | null
>;

/** Keeps the canvas the size of the viewport (device pixels, DPR capped). */
const createViewport = (canvas: HTMLCanvasElement) => {
  const view = { width: 0, height: 0, dpr: 0 };
  const fit = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (width === view.width && height === view.height && dpr === view.dpr) {
      return view;
    }
    view.width = width;
    view.height = height;
    view.dpr = dpr;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    return view;
  };
  return fit;
};

const createRenderer = (
  gl: GL,
  maxEquation: number | null,
  resources: Resources,
  hull: Float32Array
) => {
  const { stickerProgram, shadowProgram, stickerUniforms, shadowUniforms } =
    resources;
  const canvas = gl.canvas as HTMLCanvasElement;
  const sizeToWindow = createViewport(canvas);
  const sorter = createSorter(gl, resources.vertices, resources.triangles);
  const geometry: PeelGeometry = createGeometry();
  const turn = { cos: 1, sin: 0, width: 0, height: 0 };

  const setCommon = (locations: CommonLocations, frame: PeelFrame) => {
    gl.uniform4f(
      locations.uFrame,
      frame.cx,
      frame.cy,
      frame.width,
      frame.height
    );
    gl.uniform4f(
      locations.uAxes,
      turn.cos,
      turn.sin,
      geometry.dirX,
      geometry.dirY
    );
    gl.uniform4f(
      locations.uCurl,
      Number.isFinite(geometry.front) ? geometry.front : NO_FOLD,
      geometry.radius,
      geometry.maxAngle,
      PERSPECTIVE_DISTANCE
    );
    gl.uniform2f(locations.uViewport, turn.width, turn.height);
  };

  const drawRange = (first: number, count: number) => {
    if (count > 0) {
      gl.drawElements(gl.TRIANGLES, count * 3, gl.UNSIGNED_SHORT, first * 6);
    }
  };

  const shadowBlend = () => {
    if (maxEquation === null) {
      // No MAX blending: slide the shadow under what is already drawn.
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE_MINUS_DST_ALPHA, gl.ONE);
    } else {
      gl.blendEquation(maxEquation);
    }
  };

  /** A shadow pass over the whole (enlarged) mesh. */
  const shadow = (height: number, opacity: number, fadeIn: number) => {
    shadowBlend();
    gl.uniform4f(
      shadowUniforms.uShadow,
      SHADOW_SLIDE_X,
      SHADOW_SLIDE_Y,
      height,
      SHADOW_MARGIN
    );
    gl.uniform4f(
      shadowUniforms.uLook,
      opacity,
      SHADOW_BLUR_BASE,
      SHADOW_BLUR_PER_HEIGHT,
      fadeIn
    );
    drawRange(0, TRIANGLES);
  };

  return (frame: PeelFrame) => {
    const view = sizeToWindow();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!(frame.width > 0 && frame.height > 0)) {
      return;
    }
    peelGeometry(frame, hull, geometry);
    sorter.update(geometry.dirX, geometry.dirY, frame);
    const flat = sorter.flatCount(geometry.front);
    turn.cos = Math.cos(frame.rotation);
    turn.sin = Math.sin(frame.rotation);
    turn.width = view.width;
    turn.height = view.height;
    const lift = Math.min(1, Math.max(0, frame.lift || 0));

    activate(gl, shadowProgram);
    setCommon(shadowUniforms, frame);
    gl.uniform2f(shadowUniforms.uSize, frame.width, frame.height);
    // 1. Shadow of the curl, on the desk and on the flat part.
    if (flat < TRIANGLES) {
      shadow(0, CURL_SHADOW_OPACITY, geometry.radius * CURL_SHADOW_FADE);
    }
    // 2. The flat part, darkened by whatever shadow is already there.
    activate(gl, stickerProgram);
    setCommon(stickerUniforms, frame);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(
      gl.ONE_MINUS_DST_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA
    );
    drawRange(0, flat);

    // 3. The whole sticker's lift shadow, slid underneath (MAX leaves the
    // opaque sticker as it is).
    if (lift > 0) {
      activate(gl, shadowProgram);
      shadow(lift * LIFT_HEIGHT, LIFT_OPACITY * lift, LIFT_FADE);
      activate(gl, stickerProgram);
    }

    // 4. The curl, back to front.
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    drawRange(flat, TRIANGLES - flat);
  };
};

/**
 * Creates a fixed, pointer-events:none, full-viewport canvas (DPR aware,
 * resizes with the window) at `zIndex`, uploads `image` as the sticker's
 * texture. Resolves to null when WebGL is unavailable, the context or a
 * shader fails, the image can't be read (tainted), or the visitor prefers
 * reduced motion.
 */
export const createPeelLayer = async (
  image: HTMLImageElement | ImageBitmap,
  options: { zIndex?: number } = {}
): Promise<PeelLayer | null> => {
  if (typeof document === "undefined" || prefersReducedMotion()) {
    return null;
  }
  const source = await readImage(image);
  if (!source) {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = `position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:${options.zIndex ?? DEFAULT_Z_INDEX};`;
  const context = createContext(canvas);
  if (!context) {
    return null;
  }
  const { gl, maxEquation } = context;
  const resources = createResources(gl, source.pixels);
  if (!resources) {
    return null;
  }
  const render = createRenderer(gl, maxEquation, resources, source.hull);
  document.body.appendChild(canvas);

  let lost = false;
  let destroyed = false;
  const onLost = () => {
    lost = true;
  };
  canvas.addEventListener("webglcontextlost", onLost);

  return {
    hull: source.hull,
    draw(frame) {
      if (!(lost || destroyed)) {
        render(frame);
      }
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      canvas.removeEventListener("webglcontextlost", onLost);
      if (!lost) {
        resources.free();
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
      canvas.remove();
    },
  };
};
