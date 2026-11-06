import assert from "node:assert/strict";
import test from "node:test";
import {
  BLESSING,
  briefingIssues,
  characterPrompt,
  clampUserText,
  scenePrompt,
  sessionBriefing,
  turnPayload,
  utf8Size,
} from "./persona.js";

test("briefing stays inside realtime field limits", () => {
  const issues = briefingIssues();
  assert.deepEqual(issues, []);
  const briefing = sessionBriefing();
  assert.match(briefing.opening.direct_prompt.line, /这是个好事儿啊/);
  assert.equal(briefing.reply.language, "zh");
  assert.ok(briefing.chips.includes("峰哥，我想链接了"));
  assert.ok(utf8Size(briefing.reply.direct_prompt.direction) <= 1000);
  assert.ok(utf8Size(BLESSING) <= 2000);
});

test("character prompt carries the spoken habits", () => {
  const prompt = characterPrompt();
  for (const line of ["这是个好事儿啊", "面子能当饭吃吗", "想连接了", "底层不是地理位置", "二次元峰哥", "东南西北旋风财", "帕拉梅拉", "还真是", "有花堪折直须折"]) {
    assert.match(prompt, new RegExp(line));
  }
  assert.match(scenePrompt(), /hoodie/);
  assert.match(scenePrompt(), /seed photo/);
});

test("user text is clamped under the turn byte limit", () => {
  const long = "想回老家".repeat(800);
  const clamped = clampUserText(`  ${long}  `);
  assert.ok(utf8Size(clamped) <= 1800);
  assert.equal(clampUserText("  说吧  "), "说吧");
  assert.equal(clampUserText(""), "");
});

test("the link chip stays a normal turn, and a blessing request is the locked quote", () => {
  const link = turnPayload("峰哥，我想链接了");
  assert.equal(link.direct_prompt.line, undefined);
  assert.match(link.direct_prompt.direction, /想链接了/);
  const blessing = turnPayload("来一段二次元祝福");
  assert.equal(blessing.direct_prompt.line, BLESSING);
  assert.doesNotMatch(blessing.direct_prompt.line, /["<>]/);
});
