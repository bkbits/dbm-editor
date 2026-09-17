/**
 * 唯一 ID 生成器：基于 nanoid 的 21 位随机串（字符集 0-9a-zA-Z），支持业务前缀。
 *
 * 字符集刻意不含 `-` / `_`：id 会被写入 DOM 属性、元素 key 与下载文件名等场景，
 * 纯字母数字可免去转义与命名合法性顾虑。21 位随机串的碰撞概率与 UUID v4 相当。
 */
import { customAlphabet } from "nanoid";

/** 字符集：0-9a-zA-Z（62 字符） */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** 21 位 ID 生成器（customAlphabet 生成器创建一次复用，避免重复构造） */
const generateId = customAlphabet(ALPHABET, 21);

/**
 * 生成唯一 ID（21 位字母数字随机串，可选前缀）
 *
 * @param prefix 业务前缀（如 "t-" / "c-" / "dict-"），便于调试时辨识实体类型；
 *   前缀会原样拼接在 21 位随机串之前（含其中的 `-`）
 */
export function uid(prefix = ""): string {
  return `${prefix}${generateId()}`;
}
