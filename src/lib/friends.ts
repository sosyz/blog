/**
 * Friend links for pages (build time): src/data/links.ts, checked by
 * src/lib/links.ts, with each avatar file name resolved to an image in
 * src/assets/links/ so <Image> can resize it. A missing avatar file fails the
 * build instead of showing a broken image.
 */
import type { ImageMetadata } from "astro";
import { FRIEND_LINKS } from "@/data/links";
import { checkedLinks, type FriendLink } from "@/lib/links";

export type Friend = FriendLink & { image?: ImageMetadata };

/** Every image in src/assets/links/, keyed by file name. */
const AVATARS = Object.fromEntries(
  Object.entries(
    import.meta.glob<ImageMetadata>(
      "/src/assets/links/*.{png,jpg,jpeg,webp,avif}",
      { eager: true, import: "default" }
    )
  ).map(([path, image]) => [path.split("/").at(-1) ?? path, image])
);

const withAvatar = (link: FriendLink): Friend => {
  if (!link.avatar) {
    return { ...link };
  }
  const image = AVATARS[link.avatar];
  if (!image) {
    throw new Error(
      `友链「${link.name}」的头像 src/assets/links/${link.avatar} 不存在`
    );
  }
  return { ...link, image };
};

/** All friends, in the order written in src/data/links.ts. */
export const getFriends = (): Friend[] =>
  checkedLinks(FRIEND_LINKS).map(withAvatar);
