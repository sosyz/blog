import { generateText } from "ai";
import { openrouter } from "./gateway";

const IMAGE_ALT_PROMPT =
  "你是一名图片描述助手，你讲帮助视觉障碍人士理解图片内容。请根据图片生成简短的描述文本。";

export const generateImageAlt = async (image: Buffer | string) => {
  try {
    const imageBase64 =
      image instanceof Buffer ? image.toString("base64") : image;
    const { text } = await generateText({
      model: openrouter("qwen/qwen2.5-vl-32b-instruct:free"),
      system: IMAGE_ALT_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: imageBase64,
            },
          ],
        },
      ],
    });

    return text;
  } catch (_error) {
    return "一张图片";
  }
};

import type { LocalImageService } from "astro";
import { baseService } from "astro/assets";
import sharpService from "astro/assets/services/sharp";

const service: LocalImageService = {
  ...baseService,
  ...sharpService,
  async getHTMLAttributes(options, imageConfig) {
    const ret = baseService.getHTMLAttributes?.(options, imageConfig);

    const imageSrc =
      typeof options.src === "string" ? options.src : options.src.src;

    const alt = await generateImageAlt(imageSrc);

    return { ...ret, alt };
  },
  propertiesToHash: ["src", "width", "height", "format", "quality", "alt"],
};
export default service;
