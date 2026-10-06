import { generateText } from "ai";
import { config } from "@/lib/config";
import { openrouter } from "./gateway";

const IMAGE_ALT_PROMPT =
  "你是一名图片描述助手，你讲帮助视觉障碍人士理解图片内容。请根据图片生成简短的描述文本。";

const FALLBACK_ALT = "一张图片";

export const generateImageAlt = async (image: Buffer | string) => {
  // No key (local builds, CI without secrets): skip the network call.
  if (!config.openrouter.apiKey) {
    return FALLBACK_ALT;
  }
  try {
    const imageBase64 =
      image instanceof Buffer ? image.toString("base64") : image;
    const { text } = await generateText({
      messages: [
        {
          content: [
            {
              data: imageBase64,
              mediaType: "image",
              type: "file",
            },
          ],
          role: "user",
        },
      ],
      model: openrouter("qwen/qwen2.5-vl-32b-instruct:free"),
      system: IMAGE_ALT_PROMPT,
    });

    return text;
  } catch {
    return FALLBACK_ALT;
  }
};

import type { ImageTransform, LocalImageService } from "astro";
import { baseService } from "astro/assets";
import sharpService from "astro/assets/services/sharp";

const service: LocalImageService = {
  ...baseService,
  ...sharpService,
  async getHTMLAttributes(options, imageConfig, logger) {
    const ret =
      (await baseService.getHTMLAttributes?.(options, imageConfig, logger)) ??
      {};

    if (typeof ret.alt === "string") {
      return ret;
    }

    const imageSrc =
      typeof options.src === "string" ? options.src : options.src.src;

    const alt = await generateImageAlt(imageSrc);

    return { ...ret, alt };
  },
  propertiesToHash: ["src", "width", "height", "format", "quality", "alt"],
  // Markdown pictures get `widths` from src/lib/markdown/plugins.ts
  // (responsivePictures), and Sätteri hands property values on as strings.
  validateOptions(options, imageConfig, logger) {
    const widths = options.widths
      ?.map(Number)
      .filter((width) => Number.isInteger(width) && width > 0);
    const next = widths ? ({ ...options, widths } as ImageTransform) : options;
    return baseService.validateOptions?.(next, imageConfig, logger) ?? next;
  },
};
export default service;
