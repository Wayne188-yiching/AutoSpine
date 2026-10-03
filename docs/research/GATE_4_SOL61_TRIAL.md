# Gate 4 — GPT-6.1 Sol 數值邊界試驗

日期：2026-10-03（Asia/Taipei）

指定開發代理：GPT-6.1 Sol，High reasoning

結果：發現一個有效輸入域的浮點精度缺口；本輪未修改引擎。

## 範圍與既有證據

本輪只稽核通用直線等長 `ChainRigTemplate`，執行一個既有測試未涵蓋的新案例。
唯讀檢查 `packages/rig/src/index.ts`、`schemas/src/rig-spec.ts`、
`tests/rig-chain.test.ts`、`tests/rig-cli.test.ts` 與
`docs/reviews/GATE_4_REVIEW.json`。上述四個源碼／測試檔案的 staged 和 unstaged
diff 皆為空。本輪唯一新增檔案為本紀錄，未清理、提交或推送既有工作。

2026-09-24 的 Jev `APPROVED` 0.96、69 tests 與 100 次相同序列化是既有紀錄，
本輪未重跑、未擴充該核准的涵蓋範圍，也沒有新的 Jev 呼叫或核准。
Gate 3.2 的進度、Gate 5、權重、綁圖、動畫、自動關節辨識均不在本輪範圍。
此開發代理未呼叫外部服務，也未使用 TypeSafe／Jev 額度。GPT-6.1 Sol 代理仍有 Codex Token 使用；本輪精確 input／output／total 未提供，記為「無法取得」，不填 0。

## 案例與結果

```json
{
  "id": "sol61-large-origin",
  "name": "Sol61 large origin",
  "start": [10000000000000000, 0],
  "end": [10000000000000004, 0],
  "boneCount": 256
}
```

本機 Node.js `v24.14.0`。直接讀取當前 TypeScript 源碼並在記憶體轉譯執行；
沒有重新 build 或依賴可能過期的 `packages/rig/dist`。
以獨立的 2×2 仿射矩陣及平移量逐節組合父子變換，不使用既有 `worldJoints` 測試 helper。

| 觀察量                 | 實際值                               |
| ---------------------- | ------------------------------------ |
| 生成器接受輸入         | 是，產生 256 節                      |
| 每節骨長／子骨 local X | `0.015625`（`1/64`）                 |
| 全部骨長相等           | 是                                   |
| 局部骨長總和           | `4`                                  |
| 世界起點的相異數量     | `1`，全部為 `[10000000000000000, 0]` |
| 還原出的最終 tip       | `[10000000000000000, 0]`             |
| 要求的最終 tip         | `[10000000000000004, 0]`             |
| 終點誤差（實際減要求） | `[-4, 0]`，絕對距離 `4`              |
| 要求／實際世界位移     | `4`／`0`                             |

## 判斷與必要後續

`start`、`end` 都是可表示且不同的有限數，`boneCount=256` 在現有合法範圍內，
總長有限，每節長度也非零，因此現有檢查接受此輸入。
在 `1e16` 附近，相鄰可表示雙精度數的間隔為 `2`；每次加上 `1/64` 都被捨入回原值。
256 節各自的 world transform 因而重疊，最終 tip 也沒有移動。
本案例全為零旋轉，骨長 `1/64` 與局部總長 `4` 均可精確表示，
所以缺口來自大世界起點與微小逐節位移的組合，不是三角函數誤差或骨長計算錯誤。

這個 RigSpec 在實數算術下具有正確的局部幾何；以一般 JavaScript Number
父子世界變換求值時卻失去整條鏈的位移。端點誤差相對世界座標很小（約 `4e-16`），
但相對要求的鏈位移為 100%，因此只採世界座標量級的相對容差會掩蓋坍縮。
`generateChainRig` 的註解承諾 final tip reaches end，現有文件也沒有宣告排除此數值範圍。
此案例揭露該承諾需要補上有效數值域或明確誤差政策；不推論一般大小的既有案例失敗。

必要後續是由主代理確認數值政策，優先考慮：對無法在正常父子變換下保留鏈位移的輸入，
評估 `RIG_NUMERIC_PRECISION` 類 rig-stage 輸入拒絕或有效輸入域限制，
並在後續修補時新增此案例的定向回歸檢查。
容差應與鏈長及關節幾何相關，避免只因世界座標很大就接受整條鏈坍縮。
實作前必須完整讀取 `docs/SPINE_APPLICATION_KNOWLEDGE.md`。
本輪只提出需求，未選定 guard 演算法、錯誤碼或容差值，也未實作修補。
改變起點、改成不等長骨或套用 origin rebasing 會改變目前資料契約，不應為此案例直接引入。

## 可重現命令

在 `C:\Wayne\Codex\AutoSpine` 以 PowerShell 執行以下命令。
只使用既有本機 TypeScript 套件，全部轉譯與計算留在記憶體，無檔案寫入。

```powershell
@'
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync("packages/rig/src/index.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { generateChainRig } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
const input = {
  id: "sol61-large-origin", name: "Sol61 large origin",
  start: [1e16, 0], end: [1e16 + 4, 0], boneCount: 256,
};
const rig = generateChainRig(input);
// Independent affine parent/local composition; no test helper or generator math copied.
const poses = new Map();
for (const bone of rig.bones) {
  const p = bone.parentId ? poses.get(bone.parentId) : { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  if (!p) throw new Error("Missing parent");
  const radians = bone.rotation * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  poses.set(bone.id, {
    a: p.a * cos + p.c * sin,
    b: p.b * cos + p.d * sin,
    c: -p.a * sin + p.c * cos,
    d: -p.b * sin + p.d * cos,
    tx: p.tx + p.a * bone.x + p.c * bone.y,
    ty: p.ty + p.b * bone.x + p.d * bone.y,
  });
}
const last = rig.bones.at(-1), pose = poses.get(last.id);
const worldTip = [pose.tx + pose.a * last.length, pose.ty + pose.b * last.length];
const error = [worldTip[0] - input.end[0], worldTip[1] - input.end[1]];
const localLengthSum = rig.bones.reduce((sum, bone) => sum + bone.length, 0);
console.log(JSON.stringify({
  runtime: process.version,
  input,
  accepted: true,
  boneCount: rig.bones.length,
  root: rig.bones[0],
  childSample: rig.bones[1],
  allLengthsEqual: rig.bones.every(bone => bone.length === 1 / 64),
  distinctWorldOrigins: new Set([...poses.values()].map(p => p.tx + ":" + p.ty)).size,
  worldTip,
  expectedTip: input.end,
  endpointError: error,
  endpointErrorMagnitude: Math.hypot(...error),
  requestedDisplacement: input.end[0] - input.start[0],
  observedDisplacement: worldTip[0] - input.start[0],
  localLengthSum,
  originSpacing: (input.start[0] + 2) - input.start[0],
  endpointMatches: worldTip[0] === input.end[0] && worldTip[1] === input.end[1],
}, null, 2));
'@ | node --input-type=module
```

命令 exit code 為 `0` 代表稽核腳本正常執行；輸出的 `endpointMatches: false`
是本案例的幾何失敗結果，不能把腳本成功退出解讀為 Gate 通過。

## 驗證限制

這是單一新邊界案例的一次實測，沒有重跑既有通過案例、全套測試、CLI 測試或
100 次決定性測試；沒有進行 Spine 官方匯入、播放或視覺驗收。
結果只證明目前源碼在此組 JavaScript Number 父子變換下的行為，
不宣稱所有消費端均採相同內部精度或相同變換累加方式。
歷史 Jev 核准檔案保持原樣，此次發現與後續處理須另行追蹤。
