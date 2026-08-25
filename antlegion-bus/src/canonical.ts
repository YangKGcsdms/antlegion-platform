/**
 * v2 事实总线的两个自包含原语：规范化 JSON 序列化
 * （与 Python `json.dumps(sort_keys=True)` 逐字节兼容）和一个 glob 匹配器。
 *
 * 这是 v2 从 v1 引擎借用的仅有的两样东西；在此内联一份，
 * 让 v2 作为唯一架构独立存在。
 */

/** 简单 glob 匹配：`*` = 任意长度子串，`?` = 恰好一个字符。 */
export function globMatch(pattern: string, text: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern
        // 先转义正则元字符（`*` 与 `?` 故意不在此集合内，留给下面翻译）
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        // 再把 glob 通配符翻译成正则
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$", // 加 ^ $ 要求整串匹配，而非子串匹配
  );
  return regex.test(text);
}

/**
 * 键递归排序后的 JSON.stringify，输出与 Python
 * `json.dumps(sort_keys=True, ensure_ascii=False)` 逐字节一致。
 *
 * 为什么必须自己写：事实的 `id` 是内容哈希（见 hash.ts），任何语言的实现
 * 都要对同一对象算出同一串字节，否则跨语言 id 对不上
 * （conformance/verify.py 就是用 Python 反向核对这一点）。与原生
 * JSON.stringify 的关键差异是分隔符用 ", " 与 ": "（Python 的默认 separators）。
 *
 * `floatKeys` 指定哪些字段在 Python 里是 float：整数值的 float 在 Python
 * 渲染为 `1.0`，而 JS 的 String(1) 是 `1`，故这些字段值为整数时补 `.0`。
 * （按键名匹配，任意层级生效，不限顶层。）
 */
export function stableJsonStringify(obj: unknown, floatKeys?: ReadonlySet<string>): string {
  return jsonSerialize(sortKeys(obj), floatKeys);
}

function jsonSerialize(value: unknown, floatKeys?: ReadonlySet<string>): string {
  // null 与 undefined 都写成 null。注意与原生不同：原生会把值为 undefined
  // 的键整个丢掉，这里保留键并写 null。
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  // 字符串交给原生做转义；原生默认不转义非 ASCII，正对应 ensure_ascii=False
  if (typeof value === "string") return JSON.stringify(value);
  // 数字：-0 显式写成 "0"；其余交给 String()，常见取值范围内与 Python repr 一致
  if (typeof value === "number") return Object.is(value, -0) ? "0" : String(value);
  if (Array.isArray(value)) {
    // 元素间用 ", "（逗号+空格），与 Python 默认一致；原生是紧凑的 ","
    return `[${value.map((v) => jsonSerialize(v, floatKeys)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries: string[] = [];
    // 键已由 sortKeys 排好序，Object.entries 按插入顺序返回即为排序顺序
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const serialized =
        // 命中 floatKeys 且为有限整数 → toFixed(1) 补 ".0"，模拟 Python float
        floatKeys?.has(k) && typeof v === "number" && Number.isFinite(v) && Number.isInteger(v)
          ? v.toFixed(1)
          : jsonSerialize(v, floatKeys);
      // 键与值之间用 ": "（冒号+空格），同样是 Python 默认
      entries.push(`${JSON.stringify(k)}: ${serialized}`);
    }
    return `{${entries.join(", ")}}`;
  }
  // 其他类型（bigint / symbol / function 等）不应出现在事实里，兜底转字符串
  return String(value);
}

/** 递归把所有对象的键按字典序重排，返回新对象（不修改入参）。 */
function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortKeys); // 数组保持顺序，只递归元素
  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    // 默认 sort() 按 UTF-16 码元比较，Python sort_keys 按码点比较；
    // 仅当键含 BMP 之外字符（如 emoji）时才可能有分歧，事实的键名均为 ASCII，不受影响
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value; // 标量原样返回
}
