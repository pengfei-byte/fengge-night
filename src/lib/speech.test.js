import assert from "node:assert/strict";
import test from "node:test";
import { isEchoOf } from "./speech.js";

test("chinese echo of the caption is ignored", () => {
  const opening = "这是个好事儿啊。你能坐这儿，说明你还没被整麻。说吧。";
  const reply = "辞职是去自由啊？我跟你说实话，那是换个地方吃苦。";
  assert.equal(isEchoOf("这是个好事儿啊你能坐这儿", opening), true);
  assert.equal(isEchoOf("说吧", opening), true);
  assert.equal(isEchoOf("还真是", "除了生死，没啥是坏事。还真是。"), true);
  assert.equal(isEchoOf("那是换个地方吃苦", [opening, reply]), true);
  assert.equal(isEchoOf("我跟你说实话那是换地方吃苦", reply), true);
  assert.equal(isEchoOf("我想辞职做自媒体靠谱吗", opening), false);
  assert.equal(isEchoOf("我想辞职做自媒体靠谱吗", reply), false);
});
