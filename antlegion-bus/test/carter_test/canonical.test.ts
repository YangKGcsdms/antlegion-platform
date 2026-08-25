// canonical的单元测试

import { describe, it } from "vitest";
import { stableJsonStringify } from "../../src/canonical.js";

describe("carter 的探针", () => {
    it("键会排序,分隔符带空格", () => {
        console.log(stableJsonStringify({ ts: 1756000000, tags: ["a", "b"], meta: { ts: 1 } }, new Set(["ts"])));
    });
});
