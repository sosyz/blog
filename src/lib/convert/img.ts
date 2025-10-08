// Bun 是全局对象，无需导入

const QUALITY_DEFAULT = 80;
const QUALITY_MIN = 0;
const QUALITY_MAX = 100;
const PNG_COMPRESSION_LEVEL_MAX = 9;
const PNG_COMPRESSION_LEVEL_DEFAULT = 3;

type ImageFormat = "png" | "webp";

export type ConvertOptions = {
  // 目标格式
  format: ImageFormat;

  // 可选：输出路径（不传则根据输入和 format 自动推导）
  outPath?: string;

  // 可选：对于 webp 的有损质量（0-100），默认 80
  // 对 png 忽略（png 一般无损，可用 -compression_level 控制）
  quality?: number;

  // 可选：是否对 webp 使用无损（等价于 -lossless 1）
  // 若为 true，则忽略 quality
  webpLossless?: boolean;

  // 可选：png 压缩级别（0-9），默认 3；数值越大越慢压缩更高
  pngCompressionLevel?: number;

  // 可选：是否覆盖已存在的 outPath 文件，默认 true
  overwrite?: boolean;

  // 可选：是否返回完整的 ffmpeg stdout/stderr 输出用于调试
  captureOutput?: boolean;

  // 可选：额外的原样传给 ffmpeg 的参数（高阶用法）
  extraArgs?: string[];
};

export type ConvertResult = {
  success: boolean;
  inPath: string;
  outPath: string;
  format: ImageFormat;
  exitCode: number;
  stdout?: string;
  stderr?: string;
};

/**
 * 根据输入路径推导输出路径（替换扩展名为目标格式）
 */
function deriveOutPath(inPath: string, format: ImageFormat): string {
  const dot = inPath.lastIndexOf(".");
  if (dot <= 0) {
    return `${inPath}.${format}`;
  }
  return `${inPath.slice(0, dot)}.${format}`;
}

/**
 * 生成 ffmpeg 参数数组
 */
function buildFfmpegArgs(
  inPath: string,
  outPath: string,
  opts: Required<
    Pick<
      ConvertOptions,
      | "format"
      | "quality"
      | "webpLossless"
      | "pngCompressionLevel"
      | "overwrite"
    >
  > & { extraArgs?: string[] }
): string[] {
  const args: string[] = [];

  // 覆盖开关
  args.push(opts.overwrite ? "-y" : "-n");

  // 输入
  args.push("-i", inPath);

  // 针对格式的参数
  if (opts.format === "webp") {
    args.push("-f", "webp", "-c:v", "libwebp");
    if (opts.webpLossless) {
      // 无损 webp
      args.push("-lossless", "1");
    } else {
      // 有损质量
      const q = Math.max(
        QUALITY_MIN,
        Math.min(QUALITY_MAX, Math.floor(opts.quality))
      );
      args.push("-q:v", String(q));
    }
  } else if (opts.format === "png") {
    // png 一般无损；可设置压缩级别（0-9）
    const level = Math.max(
      0,
      Math.min(PNG_COMPRESSION_LEVEL_MAX, Math.floor(opts.pngCompressionLevel))
    );
    args.push("-f", "png", "-compression_level", String(level));
  }

  // 追加高级参数（如果有）
  if (opts.extraArgs && opts.extraArgs.length > 0) {
    args.push(...opts.extraArgs);
  }

  // 输出
  args.push(outPath);

  return args;
}

/**
 * 检查 ffmpeg 可用性
 */
async function ensureFfmpegAvailable(): Promise<void> {
  const ff = await Bun.which("ffmpeg");
  if (!ff) {
    throw new Error(
      "ffmpeg 未找到。请确保已安装并加入 PATH，例如: " +
        "macOS: brew install ffmpeg；Ubuntu: sudo apt-get install ffmpeg；" +
        "Windows: 安装并将 ffmpeg.exe 所在目录加入 PATH。"
    );
  }
}

/**
 * 异步转换函数（推荐）
 */
export async function convertImage(
  inPath: string,
  options: ConvertOptions
): Promise<ConvertResult> {
  if (!inPath) {
    throw new Error("inPath 不能为空");
  }
  await ensureFfmpegAvailable();

  const format = options.format;
  if (format !== "png" && format !== "webp") {
    throw new Error("format 仅支持 'png' 或 'webp'");
  }

  const outPath = options.outPath ?? deriveOutPath(inPath, format);

  const args = buildFfmpegArgs(inPath, outPath, {
    format,
    quality: options.quality ?? QUALITY_DEFAULT,
    webpLossless: options.webpLossless ?? false,
    pngCompressionLevel:
      options.pngCompressionLevel ?? PNG_COMPRESSION_LEVEL_DEFAULT,
    overwrite: options.overwrite ?? true,
    extraArgs: options.extraArgs,
  });

  const proc = Bun.spawn(["ffmpeg", ...args], {
    stdout: options.captureOutput ? "pipe" : "ignore",
    stderr: options.captureOutput ? "pipe" : "pipe",
  });

  const [{ exitCode }, stdoutStr, stderrStr] = await Promise.all([
    proc.exited,
    options.captureOutput ? proc.stdout?.text() : Promise.resolve(""),
    proc.stderr?.text(),
  ]);

  const success = exitCode === 0;

  if (!success) {
    const msg =
      `ffmpeg 转换失败 (exitCode=${exitCode}). ` +
      (stderrStr ? `stderr: ${stderrStr}` : "");
    throw new Error(msg);
  }

  return {
    success,
    inPath,
    outPath,
    format,
    exitCode,
    stdout: options.captureOutput ? stdoutStr : undefined,
    stderr: stderrStr,
  };
}
