import assert from "node:assert/strict";
import test from "node:test";
import { isEchoOf } from "./speech.js";

test("chinese echo of the caption is ignored", () => {
  assert.equal(isEchoOf("这是个好事儿啊你能坐这儿", "这是个好事儿啊。你能坐这儿，说明你还没被整麻。说吧。"), true);
  assert.equal(isEchoOf("我想辞职做自媒体靠谱吗", "这是个好事儿啊。你能坐这儿，说明你还没被整麻。说吧。"), false);
});
