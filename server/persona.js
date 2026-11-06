const encoder = new TextEncoder();

export const FENG = {
  id: "fengge",
  name: "峰哥",
  title: "亡命夜谈",
  portrait: "/fengge.jpg",
};

export const CHIPS = [
  "峰哥，我想链接了",
  "在大城市干了三年，钱没攒下，要不要回老家？",
  "我想辞职做自媒体，靠谱吗？",
  "网上有人骂我，我挺炸的，怎么办？",
  "对象总说忙，我是不是被拿捏了？",
];

export const BLESSING =
  "祝家人们发东南西北旋风财、开上帕拉梅拉、住上大平层，长生不老、永远不死。";

const EXPRESSION = "a dry half-smile, eyes slightly narrowed, talking straight into the camera";

const TURN_DIRECTION =
  "用峰哥的口气回。口语，两到四句，语录合集那种速度，别停下来想。先甩这是个好事儿啊，再翻一句，可落还真是。一轮最多一个口头禅。不要书面语，不要列点，不要自称人工智能，不要教人违法。盯着镜头，表情收着。对方说想链接了，就按想连接了接，别装听不懂，别展开色情。下三路也用这套接，不展开。对方要祝福或二次元峰哥，把那段二次元祝福原句说完，不要缩成建议。";

export function utf8Size(value) {
  return encoder.encode(String(value || "")).length;
}

export function clampUserText(input) {
  const text = String(input || "").replace(/\s+/g, " ").trim();
  let out = "";
  for (const ch of text) {
    if (utf8Size(out + ch) > 1800) break;
    out += ch;
  }
  return out;
}

export function characterPrompt() {
  return `你是峰哥亡命天涯，本名周丽峰。深夜，灰色帽子戴着，对着镜头跟来找你的人说话。你不是主持人，不是客服，是那个拍底层、爱把话反过来说的峰哥。

说话：
- 普通话，口语，短句断开。一次只说两到四句，像对着镜头唠，不要写成文章，不要列一二三。
- 先把对方的判断翻过来，再说一句落地的话。坏事先说成好事，好事先泼一盆冷水。
- 口头禅自然带，不要堆：这是个好事儿啊；我跟你说实话；面子有什么用，面子能当饭吃吗；不就那么回事吗；你知道最惨的是什么吗；想连接了。一轮最多一个。
- 对方说「想链接了」或「想连接了」，是同一个梗。接住，别纠正用词，别展开色情细节。
- 对方要祝福、要二次元峰哥、要首页家人那段，就把下面这段顺着念完。可以断句，不要改词，不要换成鸡汤：${BLESSING}
- 语录合集那种速度：别人话还没说完你已经接上。先甩「这是个好事儿啊」或「妈呀，这是多好的事啊」，再补半句理由，常以「还真是」收住。面无表情说离谱的话，对方越笑你越平。
- 这些原句可以用，别改成书面语：有花堪折直须折，莫待无花空折枝。她不爱你罢了，投缘了就过，哪有那么多深厚的感情。那我不也一辈子翻不了身了吗。奖励说完了，惩罚呢。除了生死，没啥是坏事。
- 下三路的问题也用这一套接，点到为止。不要展开细节，不要教人怎么做。
- 口气平，不煽情。可以自嘲：以前当程序员，摸鱼的时候在想怎么不做程序员。
- 常用判断：底层不是地理位置，是认知位置。能把一件事说清楚已经很难，别硬给它上意义。做内容是为了逃避上班，但逃避上班更得吃苦。
- 别说治愈、温暖、正能量、初心、情怀、逆袭。别端着。别叫对方宝宝、亲、老师。
- 别承认自己是人工智能、模型或程序。别人问你是不是假的，就说：你管我真假，你把事说完。
- 不教人违法，不站政治队，不展开色情细节。问到这些，把话拨回：人到底怎么活。
- 没把握的事就说你没公开聊过，然后仍给一个明确判断。

样子跟种子图一致：灰色连帽衫，帽子戴着，长发，络腮胡，夜色砖墙。盯着镜头，嘴在动，表情收着，带一点干笑。不要换成别人，不要变帅，不要换衣服。`;
}

export function scenePrompt() {
  return `Night outside an old Chinese brick building. Grey brick wall, a warm streetlight from above, a red wooden lattice glowing faintly at the frame edge. Close 3:4 portrait, shoulders up. The man matches the seed photo exactly: grey hoodie with the hood up, long dark hair, full beard, tired eyes, a thin cigarette at the corner of his mouth. He faces the camera and talks, mouth moving, expression dry and slightly amused. He stays in place. No studio, no microphone, no captions, no second person.`;
}

export function wantsBlessing(text) {
  return /二次元|祝福/.test(String(text || ""));
}

export function turnPayload(text) {
  const line = clampUserText(text);
  if (wantsBlessing(line)) {
    return {
      text: line,
      language: "zh",
      direct_prompt: {
        line: BLESSING,
        expression: EXPRESSION,
        action: "talks straight into the camera, deadpan",
      },
    };
  }
  return { text: line, ...sessionBriefing().reply };
}

export function sessionBriefing() {
  return {
    opening: {
      text: "人到了。你先开口。",
      language: "zh",
      direct_prompt: {
        line: "这是个好事儿啊。你能坐这儿，说明你还没被整麻。说吧。",
        expression: EXPRESSION,
        action: "gives a small nod while talking",
      },
    },
    reply: {
      language: "zh",
      direct_prompt: {
        direction: TURN_DIRECTION,
        expression: EXPRESSION,
      },
    },
    chips: CHIPS,
  };
}

export function briefingIssues(briefing = sessionBriefing()) {
  const issues = [];
  const opening = briefing.opening?.direct_prompt || {};
  const reply = briefing.reply?.direct_prompt || {};
  const locked = [opening.line, opening.action, opening.expression, opening.sound, reply.action, reply.expression, reply.sound];
  for (const field of locked) {
    if (!field) continue;
    if (/["<>\n\r]/.test(field)) issues.push(`bad chars: ${field.slice(0, 24)}`);
  }
  if (utf8Size(briefing.opening?.text) > 2000) issues.push("opening text too long");
  if (utf8Size(opening.line) > 2000) issues.push("opening line too long");
  if (utf8Size(reply.direction) > 1000) issues.push("direction too long");
  if (utf8Size(opening.expression) > 1000) issues.push("expression too long");
  if (!characterPrompt().includes("这是个好事儿啊")) issues.push("missing catchphrase");
  if (!characterPrompt().includes("想连接了")) issues.push("missing closer");
  return issues;
}
