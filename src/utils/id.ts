/** 简易唯一ID生成器（mock 场景足够） */
let counter = 0;
export function uid(prefix = ""): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}
