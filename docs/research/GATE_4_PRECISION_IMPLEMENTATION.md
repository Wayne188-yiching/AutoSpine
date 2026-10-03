# Gate 4 — 數值精度防護實作與定向驗證

日期：2026-10-03（Asia/Taipei）

開發模型：GPT-6.1 Sol，High reasoning

開發代理 Token：無法取得本輪精確使用量，不提供估算值。

本機結果：定向開發檢查通過；新版獨立審查／Jev 驗收由主代理另行處理。

## 問題與最小改動

先前試驗發現 `[1e16, 0]` → `[1e16 + 4, 0]`、256 節被接受，
但一般 double 父子世界座標變換使每節 `1/64` 位移全部捨入掉，最終世界位移為零。
詳見 [Sol 試跑紀錄](GATE_4_SOL61_TRIAL.md)。

本輪在原有輸入退化檢查及原有骨骼產生迴圈之後，新增一段私有、確定性的精度防護。
未修改 RigSpec schema、root 世界座標、等長骨長、角度、parent-first 排序、
ID／name、child local X 或 child rotation，也未新增 public FK API 或配置。
可接受輸入的原有欄位及序列化順序保持原樣；防護只會接受或回報錯誤，不會修正幾何。

新增錯誤 `RIG_NUMERIC_PRECISION` 仍使用 `ChainRigError`，
`stage=rig`、`severity=3`，原因指出失敗的 joint、門檻，以及縮小座標量級或將端點
重定位到原點附近的建議。引擎不自動更動座標、改骨長或加入 origin rebasing。
既有輸入欄位、零長度、总長溢位和每節長度下溢錯誤均先於新防護，優先順序未更動。

## 數值政策

`ENGINE_POLICY`：在一般 JavaScript Number（double）世界座標逐節累加下，
根起點、每個 joint 及最後 tip 的正規化位置誤差必須有限且 ≤ `1e-10`。
這是工程接受門檻，不是 Spine 官方標準或任意數值範圍的精確端點保證。

令 `L=hypot(dx,dy)`、`f=joint/boneCount`，逐節還原的世界位置為 `(wx,wy)`。
比較：

```text
error = hypot(
  (wx-start.x)/L - (dx/L)*f,
  (wy-start.y)/L - (dy/L)*f
)
```

此比較衡量實際世界位移對理想等距位移的誤差，尺度只用鏈長。
先正規化可避免 `L*1e-10` 或微小理想位移的乘積下溢；`dx/L` 先於乘上 `f`，
也不會產生 `dx*joint` 之類的大數乘積溢位。世界座標或誤差非有限時直接拒絕。
不使用世界原點大小作容差，不將理想 joint 先加回大原點再比較，避免兩邊一起捨入而掩蓋失真。

防護以輸出角度的 `rotation*Math.PI/180` 計算步長，從 root 世界起點開始，
依序逐節相加；所有 child local rotation 為零，因此每節方向一致。
這等價於當前直鏈的普通父子世界變換次序，包含最後一節 tip，沒有改用一次相加的捷徑。
原始角度、骨長和任何輸出欄位都不因防護而改變。

選擇 `1e-10`：在至多 256 節的正常 double 累加下，比約 `256*Number.EPSILON`
的量級（約 `5.7e-14`）有充足餘裕，同時要求幾何誤差遠小於整條鏈長。
這個量級比較只解釋工程取捨，不宣稱它是所有運算的嚴格誤差上界。
本輪沒有因個別極端案例而放宽門檻。

## 新測試與結果

先寫新增測試，再修改引擎；先紅燈、後綠燈。環境為 Windows PowerShell、
Node.js `v24.14.0`、Vitest `5.0.1`，全部使用既有本機套件。

`tests/rig-precision.test.ts` 新增 13 個測試：

- 六個失真輸入：完整坍縮、非完整坍縮的量化失真、負方向、斜向、subnormal
  骨長量化及 subnormal 斜向量化。全部要求明確的精度錯誤與可採取行動的原因。
- 一個途中 joint 失真但最終 tip 正確的案例：`2**53-2` → `2**53+2`，三節。
  未加防護時累加 `4/3` 會讓第一 joint 位移為 `1`，而最終 tip 恰好落在 `end`；
  防護仍必須拒絕，證明不能只檢查 tip。
- 五個新成功案例：大原點可精確表示的 256 節鏈、極小原點短鏈、可精確表示的
  subnormal 鏈、極小斜鏈、總長接近 double 最大值但有限的鏈。
  比較完整 RigSpec 與原有契約，確認 input 不變，並以獨立仿射矩陣父子變換檢查所有 joint。
- 一個新增決定性測試：對新大原點成功 fixture 與新坍縮錯誤診斷，
  各以首次序列化為基準比較 100 次（各 100 個比較，不含首次基準）。
  未重跑既有 13 節 fixture 的 100 次测试。

`tests/rig-cli.test.ts` 新增一個精度錯誤案例，檢查 exit code 1、rig-stage
結構化診斷、不建立輸出檔與 input 原文不變。舊 CLI 成功案例另做受影響的定向回歸。

| 執行                                    | 實際結果                                                      |
| --------------------------------------- | ------------------------------------------------------------- |
| 修改引擎前的新增案例                    | **9 failed / 5 passed / 2 skipped**，2 files failed；預期紅燈 |
| 修改後新增案例＋4 個既有方向＋CLI 成功  | **19 passed / 13 skipped**，3 files passed                    |
| build                                   | exit code 0                                                   |
| 測試 TypeScript typecheck               | exit code 0                                                   |
| 三個改動 TypeScript 檔案 ESLint         | exit code 0                                                   |
| 三個改動 TypeScript 檔案 Prettier check | exit code 0                                                   |

紅燈的八個 precision 失敗都是「應拒絕卻被接受」；新 CLI 精度案例也回傳 0 而非 1。
五個新成功案例在修改前已通過。綠燈的 19 個案例為 13 個新增 precision、
4 個既有方向、1 個既有 CLI 成功和 1 個新增 CLI 精度錯誤。
沒有 process-spawn 沙箱失敗，也未使用權限升級。

在兩個被拒絕的 subnormal 案例中，測試另確認 `L*1e-10===0`；
成功的 subnormal fixture 也刻意具有這種下溢的絕對容差。
實作與測試均比較正規化誤差，沒有使用寬鬆的 `toBeCloseTo` 掩蓋極小數失真。

## 本輪執行命令

以下命令的工作目錄均為 `C:\Wayne\Codex\AutoSpine`，使用既有本機依賴。
引擎改動前已完整讀取 karpathy-guidelines `SKILL.md`、
`docs/SPINE_APPLICATION_KNOWLEDGE.md` 和本輪
`docs/reviews/gate-4-precision/review.html` 計畫。
另唯讀檢查了目前 rig 源碼、兩個既有 rig 測試、TypeScript／ESLint／Prettier
設定及限定檔案的 Git 狀態；沒有變更這些設定。

```powershell
# 先新增測試，建置未修補引擎及 CLI，再執行紅燈案例。
node node_modules/typescript/bin/tsc -b packages/rig packages/cli
node node_modules/vitest/vitest.mjs run tests/rig-precision.test.ts tests/rig-cli.test.ts --pool=threads -t 'Gate 4 numeric precision|precision error'

# 新增 guard 後，只格式化本輪三個 TypeScript 檔案並重建。
node node_modules/prettier/bin/prettier.cjs --write packages/rig/src/index.ts tests/rig-precision.test.ts tests/rig-cli.test.ts
node node_modules/typescript/bin/tsc -b packages/rig packages/cli

# 綠燈：限定新增測試和受 guard 影響的既有成功案例。
node node_modules/vitest/vitest.mjs run tests/rig-precision.test.ts tests/rig-chain.test.ts tests/rig-cli.test.ts --pool=threads -t 'Gate 4 numeric precision|constructs parent-local bones|writes the generated rig|precision error'

# 靜態檢查，不執行其他 Gate 的測試。
node node_modules/typescript/bin/tsc -p tests/tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js packages/rig/src/index.ts tests/rig-precision.test.ts tests/rig-cli.test.ts
node node_modules/prettier/bin/prettier.cjs --check packages/rig/src/index.ts tests/rig-precision.test.ts tests/rig-cli.test.ts

# 限定變更範圍的唯讀檢查。
git diff --numstat -- packages/rig/src/index.ts tests/rig-chain.test.ts tests/rig-cli.test.ts
git diff --cached -- packages/rig/src/index.ts tests/rig-chain.test.ts tests/rig-cli.test.ts
git diff -- packages/rig/src/index.ts tests/rig-cli.test.ts
```

新增 test／source 使用 `apply_patch`。首次讀取設定時曾查詢不存在的
`eslint.config.js` 和 `vitest.config.ts`；改讀实际存在的 `eslint.config.mjs`，
Vitest 使用專案預設設定。這些是唯讀查詢，不是 build／test 失敗。
`git diff` 的使用者全域 ignore 檔案權限 warning 不影響限定 diff 結果；未修改 Git 設定。
最後另對本紀錄執行限定的 Prettier 格式整理與檢查。

## 改動範圍與未重跑項目

本輪開發代理只修改：

- `packages/rig/src/index.ts`：精度防護與 API 註解。
- `tests/rig-cli.test.ts`：新增一個 CLI 精度錯誤測試。
- `tests/rig-precision.test.ts`：新增 13 個定向測試。
- `docs/research/GATE_4_PRECISION_IMPLEMENTATION.md`：本紀錄。

`tests/rig-chain.test.ts` 保持原樣。沒有 staging、commit、push 或刪除既有工作。
TypeScript build 會建置 rig／CLI 的 referenced dependencies 和本機產物；
沒有修改其他 Gate 的源碼，也沒有執行其測試。

綠燈命令明確略過 12 個既有 rig-chain 測試（11 個輸入退化檢查及舊 100 次決定性）
和 1 個既有 CLI 退化錯誤測試。新 guard 位於既有退化拒絕之後，其分支與優先順序
未改動，因此復用歷史證據；其他 Gate 的未變更模組亦不重跑。
未執行 `npm run verify` 或全套 Vitest，歷史的 69 tests／100 次結果不當成本輪重驗結果。

## 限制與交接

本輪證明的是直線、等長、明確端點 RigSpec 的 double 數值政策，
不證明所有消費端採用相同內部精度，也不是 Spine 官方匯入／播放或視覺驗收。
工程門檻可能拒絕使用者仍想保留的極端數值；此時回報可解釋的錯誤，由呼叫端
明確決定座標系與數值量級，不在引擎偷偷變換資料。

Gate 3.2 暫緩狀態、Gate 5、權重、綁圖、動畫、自動關節辨識及外部服務均未觸及。
本代理沒有呼叫 Jev、外部服務或新增其他代理；沒有修改歷史核准 JSON。
主代理負責獨立審查、後續證據與使用者授权的正式送審，不能以這份本機開發報告
冒稱新版 Jev 已核准。
