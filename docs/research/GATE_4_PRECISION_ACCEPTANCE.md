# Gate 4 — 精度修補正式驗收紀錄

日期：2026-10-03（Asia/Taipei）

狀態：**APPROVED**，本機開發驗證及新版 Jev 正式驗收均通過。

開發：指定 GPT-6.1 Sol High 開發代理；主代理負責獨立稽核、送審及文件。

介面：[本輪驗收頁](../reviews/gate-4-precision/review.html) · [所有 Gate 狀態](../../GATE_STATUS.html)。

## 核准範圍與修補

沿用 `ChainRigTemplate` 明確起終點與骨數、直線等長、parent-first 的 `RigSpec` 契約。
新增每個重建世界 joint（包含根與最後 tip）的鏈長正規化誤差檢查，門檻為 `1e-10`。
失真或非有限的世界累加回報 `RIG_NUMERIC_PRECISION`（stage=rig、severity=3）。
正常輸出的原座標、角度、長度、父子關係及序列化順序保持不變，不以移動原點、改骨長
或放寬大世界座標容差湊結果。依 karpathy-guidelines 採用最小修補，沒有新增公開
數值設定、正向運動學 API 或未使用的抽象。

這是 JavaScript Number 數值輸入政策，不是 Spine 官方精度標準；核准不涵蓋圖像關節辨識、
自動 pivot、綁圖、權重、動畫、完整 Spine 場景匯入或播放。

## 本輪驗證，與歷史證據分開

| 證據                                  | 本輪結果                                                       |
| ------------------------------------- | -------------------------------------------------------------- |
| 先紅燈再修補                          | 新案例 9 failed / 5 passed / 2 skipped，符合預期；不是目前結果 |
| 修改後定向 rig／CLI 測試              | 19 passed / 13 skipped，3 files passed                         |
| 新增審核門檻測試                      | 13 passed，缺資料、低分或有阻礙不得誤核准                      |
| 新增獨立矩陣世界變換稽核              | 4 / 4 通過，與既有單元測試案例不同                             |
| 新成功／新錯誤決定性                  | 各與首次基準比較 100 次，完全一致                              |
| 建置及 typecheck                      | 通過                                                           |
| 限定變更程式 lint／格式／送審工具語法 | 通過                                                           |

19 項定向測試包含 13 個新精度測試、4 個實際受影響的既有方向、1 個既有 CLI 成功／
不覆寫案例、1 個新增 CLI 精度錯誤案例；後者確認 exit code 1、結構化 rig 錯誤、輸入原文
不變且不產生輸出。13 個略過項目為 12 個未受影響的既有 rig-chain 測試與 1 個舊 CLI
退化錯誤測試；新檢查位於既有拒絕之後，未改其條件或優先順序，沿用歷史通過證據。

沒有執行全套測試或 `npm run verify`，沒有重跑其他 Gate。歷史 69 tests／9 files 及舊
100 次紀錄只作歷史基線，不冒稱本輪實測。修補及具體命令見
[開發代理實作紀錄](GATE_4_PRECISION_IMPLEMENTATION.md)。

## 主代理獨立數值稽核

在記憶體中編譯舊核准提交 `5feda8a` 與目前 rig source，以獨立 2×2 仿射矩陣逐節合成
parent／local transform；使用四個不同於已通過單元測試的新案例，未修改 source／build 或
私有素材。原始數值見 [independent-audit.json](../reviews/gate-4-precision/independent-audit.json)。

| 案例                        | 原版觀察                             | 修補後                       |
| --------------------------- | ------------------------------------ | ---------------------------- |
| 10¹⁶ 起點、長 8、128 節     | 位移 0、終點誤差 8、正規化關節誤差 1 | 第 1 關節明確拒絕            |
| 負的大原點、長 4、3 節      | 終點誤差 0，但途中正規化誤差 1/6     | 第 1 關節明確拒絕            |
| 10¹⁶ 起點、長 1,024、128 節 | 精確表達，誤差 0                     | 接受，輸出與舊版逐位元組相同 |
| (−32,24) → (160,−72)、6 節  | 正規化關節誤差 1.57e-16              | 接受，輸出與舊版逐位元組相同 |

拒絕失真輸入是核准的防護行為，不代表為該極端輸入生成了正確骨鏈。
可接受的大座標輸入仍正常生成，不因原點很大一律拒絕。

## 正式 Jev 裁決與授權

使用者在本輪明確同意指定新資料包、`https://api.typesafe.ai/v1/systemone` 與 TypeSafe
額度使用，主代理才執行一次 POST。沒有沿用先前 Gate 3.2 的授權、沒有自動重試。
內容為測試統計、四個自製數值案例、精度檢查程式片段及技術摘要；不含原圖、影片、
Spine 原檔、人工座標或憑證。

- 實際請求：[GATE_4_PRECISION_REQUEST.json](../reviews/GATE_4_PRECISION_REQUEST.json)，13,650 bytes。
- 請求 SHA-256：`db75450278ff2e2a4d20cb8092a601ecfddc1ec45f3fee2d4a338748d4144b7a`。
- 送審工具：[jev-gate4-precision-review.mjs](../../tools/jev-gate4-precision-review.mjs)，
  提交前比對 rig source hash，拒絕舊證據及既有輸出覆寫；不安裝 SDK、不變更共用舊送審工具。
- 原始裁決：[GATE_4_PRECISION_DECISION.json](../reviews/GATE_4_PRECISION_DECISION.json)。
- 模型：`jev-1.13.0`；回應時間：`2026-10-03T06:20:11.103Z`（台灣時間 14:20）。

| 門檻                   | 要求     | Jev 回應 |
| ---------------------- | -------- | -------- |
| Verdict                | APPROVED | APPROVED |
| APPROVED probability   | ≥0.80    | 0.98     |
| Scope compliant        | ≥0.80    | 0.98     |
| DoD satisfied          | ≥0.80    | 0.90     |
| Tests credible         | ≥0.80    | 0.89     |
| Deterministic evidence | ≥0.80    | 0.86     |
| Regression safe        | ≥0.80    | 0.95     |
| Architecture compliant | ≥0.80    | 0.95     |
| Evidence Quality       | ≥3.50/4  | 3.99/4   |
| Primary Blocker        | NONE     | NONE     |

依原有全部必要門檻推導 **APPROVED**，沒有因服務回覆 APPROVED 就跳過其他分數，
也沒有調低門檻。13 項新門檻測試確認缺資料、低分、超界、字串分數或阻礙均不能誤核准。

## 版本綁定與用量

送審及獨立稽核綁定的 `packages/rig/src/index.ts` SHA-256：
`c483ffac3430d29a0178c098cc1efd7de882bb8824aeb5129966eedd8f48aadd`。
正式送審後只整理文件及截圖，未再修改核准的引擎或測試。
舊 [GATE_4_REVIEW.json](../reviews/GATE_4_REVIEW.json) 原樣保存。

進度快照加入精確檔案範圍的 `.gitattributes` 規則，避免 Git 自動換行轉換破壞
已核准 rig source、實際 Jev 請求與既有骨鏈 JSON 的位元組雜湊；沒有改動演算法。

本次 Jev input **3,693**、output **270**，合計 **3,963 tokens**。
開發代理及主代理逐 Gate 精確用量無法取得；不填 0、不估算，不以 Jev 用量冒充全開發成本。

## 保留未完成項目

Gate 3.2 按使用者決定暫緩，仍為 23／164，並未因本核准變成通過。
Gate 5 尚未開始。完成正式驗收當時沒有 staging、commit 或 push；使用者隨後另行明確要求
將目前進度推送 GitHub，因此本次允許 source-only 進度快照，不代表 Gate 3.2 已通過。
本機截圖位於排除 Git 的 `docs/local-reviews/gate-4-precision.png`，不納入推送。

## 骨架視覺補充（不變更核准程式）

依使用者要求，驗收頁另加入 [骨架專用視圖](../reviews/gate-4-resume/review.html?view=skeleton)，
從既有 `gate-4-resume/chain-rig.json` 還原 5 根骨骼、6 個關節、骨骼朝向及父子關係。
沿用原始 CLI 輸出與歷史檢查，不重新生成骨鏈、不重跑已通過測試，也不追加 Jev 呼叫。
畫面只增加尖形骨骼圖示及專用檢視，不改 RigSpec 或引擎。

本機截圖：`docs/local-reviews/gate-4-skeleton.png`，排除於 Git。
這是實際資料的靜態圖，不是 Spine 編輯器截圖，亦不是角色圖片、網格與權重的綁定驗收。
本次呈現檢查確認內嵌資料與既有原始 JSON 一致，原始輸出雜湊及已核准引擎雜湊不變，
瀏覽器實際繪出 5 個骨骼圖示、6 個關節及 5 列資料；另直接查看截圖確認骨架顯示。
