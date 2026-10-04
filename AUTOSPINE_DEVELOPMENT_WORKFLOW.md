# AutoSpine 集中式開發與 Jev 驗收流程

版本：0.2  
狀態：流程已定義；Jev SDK 介面已由 `D:\Wayne\JevTest` 驗證  
適用範圍：Gate 0～17

## 最新授權覆寫 — 2026-10-05（Gate 17／自行驗收）

使用者最新明示：「先以開發到 Gate 17 為主，驗收部分請自行驗收，這部分自動化完成」。此指示取代以下舊版魚切片限制、必須 Jev 及等待下一指令規則。依序完成各工程 Gate，助手自行驗證／審核後進下一 Gate，每次 Gate 完成提交並推送一次；不以 Jev 金鑰阻塞、不發起新的付費審核。

DoD 仍需實際實作、可重現測試和限制說明；自行驗收不是人工美術核准。既有 Gate 3.2／4 圖像品質未過紀錄保留。離線 Planner／Critic 契約測試不宣稱已使用外部視覺模型。詳見 [Gate 5–17 計畫](docs/GATE_5_17_AUTONOMOUS_PLAN.html)。不得上傳私人素材或混入無關 dirty 變更。額度讀取／330 分鐘續跑工具仍不可用，不假稱已設定。

## 最新工作順序覆寫 — 2026-10-05（優先於下方歷史限制）

使用者採用 Claude 的 [DEV_REVIEW_2026-10-05.html](docs/DEV_REVIEW_2026-10-05.html)，要求先完成整體工具架構，並授權無需逐步催促的自動開發、由 Jev 驗收及每一 Gate 完成後推送一次。先完成 PNG → blind mesh → 顯式骨链 → 距離權重 → wave → Spine 的魚測試切片；不是先到 Gate 17 才開始品質優化。

此授權可開發 Gate 5／6／8／10／11 的必要 starter 功能，但不等於這些 Gate 的全範圍通過；Gate 7／9／12～17 尚未完成。舊 Gate 3.2 人工校準暫緩 23／164、Gate 4 PNG-only 0／23 及 Body 未過保留為歷史品質紀錄，不轉移成 blind 產品的成功。

正式 Gate 推送條件：該 Gate 範圍與 DoD 明確 → 本機完整生產回歸 → Jev 新驗收通過 → 精確 allowlist 提交與推送。不提交私人原圖、Spine 原檔、人工座標、影片、私有截图或憑證；不批量納入既有 dirty worktree。Jev 可以使用必要程式與測試摘要；額外私人媒體授權不得推定。

新的工具切片實作、證據及續跑限制見 [TOOL_ARCHITECTURE_PLAN.html](docs/TOOL_ARCHITECTURE_PLAN.html)、[ADR-007](docs/adr/ADR-007-toolchain-and-affine-ir.md) 及 [AUTONOMOUS_DEVELOPMENT.md](docs/AUTONOMOUS_DEVELOPMENT.md)。每輪完整 portable 測試可重跑，私有 164／23 案圖片 corpus 不重生。本機格式／lint 排除既有 generated 私有診斷及明示 immutable 提交檔，但不排除生產程式或可攜測試。

使用者要求剩餘額度 <=5% 優先保存進度並安排 330 分鐘後續跑；本工作階段沒有帳戶額度讀取或產品排程工具，因此尚未建立該機制，不得用上下文 token 或背景 shell 假稱已設定。Jev 金鑰未載入時保存待審資料，不宣稱送審成功，也不跨過驗收推送。

## 1. 文件目的

本文件是 AutoSpine 的單一開發流程來源（Single Source of Truth）。

它集中管理：

- Gate 順序與依賴
- 每個 Gate 的開發範圍
- 模型選擇與升級條件
- 實作、測試、回歸與交付步驟
- Jev 驗收規則
- Gate 通過、退件、阻塞與停止條件

產品需求、架構細節與重大決策仍分別保存在 README、ARCHITECTURE 與 ADR；但「下一步做什麼、怎樣才算完成、誰能批准進入下一 Gate」只以本文件為準，避免流程資訊散落。

## 2. 核心原則

1. AI Planning + Deterministic Execution。
2. Core 在沒有 AI 的情況下也必須完整執行。
3. Spine JSON 是 Adapter 輸出，不是內部 IR。
4. 一次只開發一個 Gate；未通過 Jev 驗收不得進入下一 Gate，除非使用者明確調整順序並保留未完成項目的紀錄。現行 Gate 4 順序例外見第 12 節（2026-10-03）。
5. 每次只做達成當前 Gate 所需的最小改動。
6. 不建立尚未被當前 Gate 使用的抽象、設定或擴充點。
7. 不用 TODO、假 Solver、永遠通過的 Validator、硬編碼 Fixture 結果宣稱完成。
8. 不確定的 Spine 格式、幾何或權重演算法先研究，明確區分 Known、Assumption、Experimental、Verified。
9. 同一份 Input + Spec + Config + Seed 必須得到相同輸出。
10. 幾何品質同時使用量化指標和視覺檢查，不以「看起來可以」作為唯一結論。
11. 涉及人工 Mesh 對照的驗收，以原始同檔附件的人工佈線為標準：依最新需求逐附件頂點數絕對誤差不得超過 ±5 點（取代歷史 ±20%），超標即不及格；數量通過仍須檢查位置、邊流與內外點分布，分辨人工實線和自動三角化虛線，不得靠湊點數過關。Jev 整體分數不可覆蓋本機硬門檻。
12. 使用者已確認「以同附件人工留白為準」：校準路徑的透明留白上限改為同附件人工外框多覆像素／原始前景像素；不加倍率，不挪用其他附件。原始前景漏覆仍 ≤2%，前處理不得掩蓋漏覆；±5、位置與線型檢查仍有效。無人工參考及既有 Tail 路徑維持原限制。舊版各 2% 的記錄只適用其歷史範圍。
13. 使用者進一步確認漏覆範圍為「人工網格實際使用的前景」：第 12 條分母改採原始 alpha >0 與同附件人工外框的交集，未清理前作為有效前景。原圖、有效、人工排除的前景數量必須揭露；來源原圖不改。生成外框若重新納入人工排除的其他圖像，另判失敗，不能算透明留白。本輪明示為人工參考限定的生成，不是獨立語意辨識或泛化訓練證據。
14. 每個 Gate 內也必須逐步驗收：先列明當前步驟的範圍、驗收條件及所需證據，條件未核定、資料不齊或任何必要檢查未通過，均不得開始後續步驟。允許在同一步內修正失敗與重測受影響項目；程式測試、單一案例改善、探索試驗或歷史核准不能替代當前步驟驗收。改用其他附件不能自動關閉原失敗項或取得進階資格。正式 Gate 核准仍須 Jev，新增付費送審另需明確授權。
15. Gate 4 必须承接 Gate 3.2 已完成靜態檢查的原 23 個附件，按 project／skin／slot／attachment 完整身份逐件驗收；其他骨鏈試驗不能取代此分母。多節骨鏈、單骨掛接及零長度控制骨依人工用途分別檢查，但分類、不支援、缺資料或共享骨不能當作通過／自動排除。23 件必要本機與視覺驗收完成，再依流程送 Jev；Gate 3.2 已通過且未受影響的證據不重跑。

## 3. 角色與責任

### 3.1 Product Owner

- 決定產品方向和藝術品質門檻。
- 提供或批准 Fixture 與預期結果。
- 處理 Jev 無法裁決的需求衝突。
- 明確批准重大範圍、IR 或架構變更。

### 3.2 Development Agent

- 僅實作當前 Gate。
- 開始前列出假設、範圍、風險與可驗證完成條件。
- 實作最小可行方案並加入測試。
- 執行自我驗證、回歸和交付資料整理。
- 不得自行宣布 Gate 通過。

### 3.3 Strongest Model Reviewer

只在高推理風險工作使用：

- Mesh topology、triangulation、deformation
- Weight Solver、joint weighting、smoothing
- Constraint architecture
- IR 或 Core architecture 重大變更
- Triangle inversion、elbow collapse、非局部 geometry regression

一般建置使用 GPT-5.6 Sol High；上述工作使用 GPT-6 Astra High 或 XHigh。Max 只用於多次失敗後仍無法定位的核心問題。

### 3.4 Jev（Gate 驗收者）

Jev 是 TypeSafe AI 提供的獨立驗收模型，也是每個 Gate 的強制驗收者。已確認的介面如下：

```text
SDK: @typesafe-ai/sdk 0.6.0
Node: >= 20
Client: TypeSafeClient
Method: client.systemOne({ state, questions })
Default model: jev-latest
Credential: TYPESAFE_API_KEY
```

目前 SDK 回傳 Choice、Noul、Score 等結構化答案，不假設 Jev 能產生自由格式驗收報告。因此 Gate 判定採用固定問題與數值門檻，讓結果可以自動保存、重跑與稽核。

Jev 負責：

- 確認實作沒有超出 Gate 範圍。
- 確認 Definition of Done 的每一項都有證據。
- 檢查測試不是為了迎合硬編碼結果。
- 檢查假設、風險與未解問題是否被揭露。
- 檢查 deterministic、compatibility 和 regression 證據。
- 發出 APPROVED、REJECTED 或 BLOCKED 結論。

Jev 不負責：

- 在驗收過程順便改需求。
- 直接修改產品程式碼。
- 在沒有證據時用主觀印象批准 Gate。
- 批准帶有未標示 placeholder 的正式 Gate。

## 4. Gate 狀態

每個 Gate 只能處於以下狀態之一：

```text
NOT_STARTED
IN_PLANNING
IN_DEVELOPMENT
DEV_VERIFIED
JEV_REVIEW
REJECTED
BLOCKED
APPROVED
```

狀態只能依下列方向前進：

```text
NOT_STARTED
  -> IN_PLANNING
  -> IN_DEVELOPMENT
  -> DEV_VERIFIED
  -> JEV_REVIEW
       -> APPROVED
       -> REJECTED -> IN_DEVELOPMENT
       -> BLOCKED
```

只有 `APPROVED` 能解鎖下一 Gate。

## 5. 每個 Gate 的標準循環

### Step 1 — Preflight

開發者先確認：

- 前置 Gate 已由 Jev 批准。
- 工作樹狀態與使用者既有變更。
- 當前 Gate 的 In Scope 和 Out of Scope。
- 可用 Fixture、外部規格與測試工具。
- 是否需要 MODEL_ESCALATION_RECOMMENDED。

輸出：簡短 Gate Brief，不修改產品程式碼。

### Step 2 — Plan

將需求轉成可驗證目標：

```text
目標
輸入
輸出
最小實作
測試
量化門檻
風險
假設
停止條件
```

若存在會改變方案的重大歧義，先向 Product Owner 確認。小型且可逆的細節可以採明示假設繼續。

### Step 3 — Implement

- 先加入或定義能證明行為的測試。
- 實作讓測試通過的最少程式碼。
- 只更動與當前 Gate 直接相關的檔案。
- 新增的設定必須在當前 Gate 實際被使用。
- 新增的抽象必須至少解決當前的真實邊界，不為未知未來預作設計。

### Step 4 — Developer Verification

依風險執行：

- Type check、lint、unit test
- Integration test、golden test
- Determinism test
- Geometry metrics 與 regression
- Spine compatibility evidence
- 必要時視覺 Preview

任何失敗都先回到 Implement，不把失敗的候選版本交給 Jev。

### Step 5 — Prepare Jev Review Bundle

交付內容集中成一份 Gate Review Bundle：

```text
Gate
Objective
In Scope
Out of Scope
Changed Files
Assumptions
Implementation Summary
Commands / Checks Run
Test Results
Metrics Before / After
Compatibility Evidence
Known Limitations
Risks
Definition of Done Checklist
Requested Jev Decision
```

證據可以引用測試報告或 Fixture，但不得要求 Jev 從大量日誌自行猜結論。

### Step 6 — Jev Review

Jev 必須逐項檢查：

1. Scope：只有當前 Gate 的必要工作。
2. Correctness：規格、Schema 和輸出行為符合目標。
3. Tests：正常、邊界、錯誤和回歸案例存在。
4. Determinism：同輸入重跑結果一致。
5. Honesty：沒有未標示 placeholder、假資料或 always-pass 驗證。
6. Architecture：依賴方向正確，沒有 Spine、AI、Skill 或 MCP 污染 Core。
7. Evidence：每項完成聲明都能追溯到測試、指標或外部規格。
8. Regression：既有已批准 Gate 沒有退化。

### Step 7 — Jev Decision

Jev 在單次 `systemOne` 呼叫中回答固定問題集：

```text
verdict: Choice(APPROVED, REJECTED, BLOCKED)
scope_compliant: Noul
dod_satisfied: Noul
tests_credible: Noul
deterministic_evidence: Noul
regression_safe: Noul
architecture_compliant: Noul
evidence_quality: Score(0..4)
primary_blocker: Choice(NONE, SCOPE, CORRECTNESS, TESTS, DETERMINISM, REGRESSION, ARCHITECTURE, EXTERNAL_INPUT)
```

自動批准門檻：

```text
verdict.choice == APPROVED
verdict.probabilities.APPROVED >= 0.80
scope_compliant >= 0.80
dod_satisfied >= 0.80
tests_credible >= 0.80
deterministic_evidence >= 0.80（當 Gate 適用）
regression_safe >= 0.80
architecture_compliant >= 0.80
evidence_quality.score >= 3.5
primary_blocker.choice == NONE
```

只要任一強制門檻未達標，就不得標記 APPROVED。流程根據 `primary_blocker` 和未達標問題產生 Required Fixes，不要求 Jev 自由撰寫修正說明。

決策規則：

- `APPROVED`：所有 DoD 和強制門檻都有證據。
- `REJECTED`：程式可修正，列出可重現且可驗證的阻擋項目。
- `BLOCKED`：缺少外部規格、素材、權限或 Product Owner 決策，現階段無法驗收。

不使用「有條件通過」。未完成的必要條件就是 REJECTED 或 BLOCKED，避免技術債在 Gate 間漂移。

### Step 8 — Close or Rework

- APPROVED：記錄基準、更新 Gate 狀態，停止並等待下一個開發指令。
- REJECTED：只修 Jev 列出的阻擋項，完整重跑相關測試後重新送審。
- BLOCKED：停止開發，明確列出唯一需要的外部輸入。

## 6. Gate 路線圖與驗收門檻

| Gate | 交付目標                                            | 主要驗證                                                    | Jev 批准條件                                                                                                    | 建議模型                   |
| ---- | --------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 0    | Repository、工具鏈、架構、IR 初版、ADR、Gate 1 計畫 | 安裝、build、lint、test、Schema type check                  | 基礎結構可重現；文件一致；沒有 Gate 1 功能偷跑                                                                  | GPT-5.6 Sol High           |
| 1    | AutoSpine IR 到最小 Spine 4.0.64 JSON               | Golden test；同 IR 重跑 100 次                              | 最小 skeleton/bone/slot/skin/region/animation 可編譯；輸出一致；格式有可靠來源                                  | GPT-5.6 Sol High           |
| 2    | PNG Parts，再擴充 PSD 到 AssetSpec                  | Parser unit/integration tests；bounds 與 hierarchy fixtures | 解析結果可序列化、可驗證、順序穩定；不包含 AI Rigging                                                           | GPT-5.6 Sol High           |
| 3    | Tail alpha 到可變形 MeshSpec                        | Contour、simplification、triangulation 測試；Mesh Validator | 無非法 index、零面積三角形、自交或非預期斷裂；固定輸入固定輸出                                                  | Astra 設計，Sol 實作       |
| 3.1  | Tail Mesh 參考佈線與頂點預算                        | Spine 23 頂點參考、輪廓覆蓋率、內部中線、回歸測試           | 維持合法與確定性；長形素材輪廓漏覆／多覆各 ≤2%；尾巴頂點數接近人工參考                                          | Sol 實作，Jev 驗收         |
| 3.2  | Yuuna／panda／pig 人工佈線校準                      | 原始 `.spine`、PNG、教學幀及完整附件實測                    | 頂點 ±5；同附件人工留白；原始前景漏覆 ≤2%；位置／線型與回歸；不核准動態變形                                     | 沿用 Gate 3 分工；Jev 驗收 |
| 4    | Deterministic ChainRigTemplate                      | 骨長、位置、旋轉、parent 單元測試                           | start/end/boneCount 產出正確 chain；退化輸入有明確錯誤                                                          | GPT-6.1 Sol High（試跑）   |
| 5    | Weight Solver v1                                    | Sum、NaN、negative、top-K、orphan、smoothing tests          | 每 vertex 有合法 influence；和為 1；最大 4；沒有假 Solver                                                       | Astra XHigh                |
| 6    | Tail deformation 與量化評估                         | Root/middle/wave poses；inversion、stretch、tearing metrics | 指標門檻明確且通過；保存 baseline；具可檢視輸出                                                                 | Astra High/XHigh           |
| 7    | Arm fixture 與 elbow deformation                    | 0/30/60/90/120 度 regression                                | 無不可接受 collapse、inversion 或不連續；指標和視覺證據一致                                                     | Astra High/XHigh           |
| 8    | Procedural Animation presets                        | 每個 preset 的輸出與 seed tests                             | wave、sway、breathing、bounce、float、rotateLoop、blink、followThrough、overshoot、squashStretch 由數值引擎生成 | GPT-5.6 Sol High           |
| 9    | 獨立 Curve Engine                                   | Curve unit tests 與端點、單調性檢查                         | linear、stepped、bezier、ease、overshoot 不與 preset 耦合                                                       | GPT-5.6 Sol High           |
| 10   | Loop Validator                                      | 首尾 translation/rotation/scale/deform 比較                 | Loop Error Score 可重現；錯誤能指出 target 與 stage                                                             | GPT-5.6 Sol High           |
| 11   | 最小 Preview                                        | 固定 frame 或 MP4 render integration test                   | Preview 能重現並對應同一 build manifest；不建立大型 GUI                                                         | GPT-5.6 Sol High           |
| 12   | Basic Humanoid Template                             | Hierarchy、對稱、fixture integration tests                  | 只含批准的基礎骨架；Tail 和 Arm regression 全過                                                                 | Sol 實作，Astra review     |
| 13   | Engine-neutral Constraints                          | IK、transform、path-like behavior tests                     | Core API 不暴露 Spine-specific constraint 結構；求解穩定                                                        | Astra High                 |
| 14   | AI Planner 到 Validated Spec                        | Structured output、schema rejection、fixture evals          | AI 只能產生通過 Schema 的 Spec；無效輸出不得觸發 Core                                                           | GPT-5.6 Sol High           |
| 15   | Visual Critic 到 CorrectionSpec                     | 已知缺陷集、precision/recall 類 eval、no-direct-edit test   | Critic 只提 CorrectionSpec；Core 決定重建；不直接改 geometry                                                    | Astra High                 |
| 16   | MCP Adapter                                         | Tool contract、error mapping、integration tests             | 演算法留在 packages；MCP 只調用 Core API                                                                        | GPT-5.6 Sol High           |
| 17   | AutoSpine Skill                                     | Decision cases、tool policy、boundary review                | Skill 是知識與規則；Core 不依賴 Skill；無重複 Engine 邏輯                                                       | GPT-5.6 Sol High           |

## 7. 垂直切片與產品里程碑

### Milestone A — Tail MVP

```text
Gate 0～6
tail.png -> Mesh -> 5 Bone Chain -> Weight -> Wave -> Spine JSON
```

成功定義：可重複、deterministic、可驗證地完成；不是只對單一輸入硬編碼。

### Milestone B — Arm / Joint MVP

```text
Gate 7
Arm Parts -> Mesh -> 3 Bone Rig -> Weight -> 90° Elbow Bend
```

成功定義：關節彎曲品質有量化基準和視覺證據，且 Tail 沒有 regression。

### Milestone C — Engine MVP

```text
Gate 8～11
Procedural Animation -> Curves -> Loop Validation -> Preview
```

成功定義：可建立、驗證並預覽 deterministic loop animation。

### Milestone D — Basic Humanoid

```text
Gate 12～13
AssetSpec -> Humanoid Rig -> Constraints -> Spine
```

成功定義：基礎人物骨架能編譯，沒有提前加入手指、複雜臉部或衣物系統。

### Milestone E — AI-assisted Workflow

```text
Gate 14～17
AI Planner -> Core -> Preview -> Visual Critic -> MCP -> Skill
```

成功定義：AI 只做決策；所有數值運算仍由 deterministic Core 完成。

## 8. 測試與證據策略

### 8.1 所有 Gate 的最低檢查

- Build
- Type check
- Lint
- Unit tests
- 新增功能的正常與錯誤案例
- 已批准 Gate 的 regression

### 8.2 需要 Golden Test 的模組

- IR serialization
- Spine JSON compiler
- Asset Parser ordering
- BuildManifest
- Seeded Animation output

Golden 更新必須附原因；不得因測試失敗直接覆寫預期結果。

### 8.3 幾何和權重門檻

至少記錄：

- Triangle Inversion Count
- Stretch Ratio
- Area Compression
- Weight Continuity
- Joint Continuity
- Loop Error

每個 Fixture 保存批准後 baseline。修改 Geometry、Rig 或 Weight 時必須比較差異；任何退化若要接受，必須由 Product Owner 明確批准並由 ADR 或 Gate 記錄說明。

### 8.4 Determinism

- 固定輸入、Spec、Config、Seed。
- 對核心輸出進行 canonical serialization 或 hash 比較。
- Gate 1 至少連續執行 100 次。
- 有隨機行為的模組必須測試相同 seed 相同輸出、不同 seed 合理不同。

## 9. 架構變更控制

以下改動必須先停止實作，寫出提案並進行 Strongest Model Review：

- IR schema 的破壞性變更
- package dependency 方向改變
- Spine-specific 結構進入 Core
- Core 開始依賴 AI、MCP 或 Skill
- Geometry 或 Weight 演算法整體替換
- 新的原生、WASM、Rust 或 Python runtime dependency
- 新增大型 GUI 或 Editor

提案固定包含：

```text
Context
Problem
Smallest viable change
Alternatives
Migration impact
Test impact
Rollback plan
Decision requested
```

批准後建立或更新 ADR；未批准不得實作。

## 10. MODEL_ESCALATION_RECOMMENDED 格式

```text
MODEL_ESCALATION_RECOMMENDED

Task:
<工作>

Reason:
<為何需要更強推理>

Risk:
<錯誤可能造成的影響>

Files involved:
<預期影響範圍>

Question to solve:
<交給最強模型的明確問題>
```

模型升級只處理指定問題，不授權修改其他架構。

## 11. 文件集中策略

為避免資訊分散：

- `AUTOSPINE_DEVELOPMENT_WORKFLOW.md`：唯一流程、Gate 狀態與驗收規則。
- `docs/SPINE_APPLICATION_KNOWLEDGE.md`：唯一 Spine 實務知識基線；所有 Spine 相關 Gate 開始前必讀。
- `ARCHITECTURE.md`：只記錄當前架構和依賴，不重複 Gate 流程。
- `ROADMAP.md`：只提供里程碑摘要並連回本文件，不另寫一套流程。
- `ASSUMPTIONS.md`：只記錄尚未驗證且會影響行為的假設。
- `BACKLOG.md`：只記錄不屬於當前 Gate 的想法。
- `docs/adr/`：只記錄已作成的重大決策及其後果。
- `docs/research/`：只保存 Mesh、Weight、Spine 格式等研究證據。

每個 Gate 的追蹤資訊優先更新本文件的「Gate 執行紀錄」。只有測試輸出或研究證據過大時才另外存檔並以連結引用。

## 12. Gate 執行紀錄

檢視入口：[Gate 完成狀態總覽](GATE_STATUS.html)；[Gate 3.2 完整圖像驗收報告（本機）](docs/local-reviews/gate-3.2-collapse-20/review.html)。本機報告資料夾排除於 Git 提交，包含 164 件逐附件對照與原始圖像；最新完整靜態通過為 23／164，正式 Jev 尚未送審。

### 2026-10-03 現行工作順序：暫緩 Gate 3.2，先進 Gate 4

使用者因 Gate 3.2 預期 Token 成本決定先進 Gate 4。即日起停止本輪 Gate 3.2 優化，保留 `REOPENED` 與 23／164 的未完成證據；不改驗收門檻、不將暫緩標為通過。此指示取代本文較早「Gate 3.2 通過後才進 Gate 4」的順序限制，僅適用 Gate 4，未授權提前開始 Gate 5，也未改變 GitHub 推送條件。

Gate 4 已有獨立的直線骨鏈核准基線。首次恢復工作時先沿用其實作與未受影響的通過證據，交付可檢視的骨鏈範例，當時未追加付費 Jev 呼叫。後續依使用者要求完成精度修補，經本次明確授權的新版 Jev 正式驗收通過；未重跑未受影響的測試。[歷史骨鏈示範](docs/reviews/gate-4-resume/review.html)；[新版精度驗收](docs/reviews/gate-4-precision/review.html)。

### 2026-10-03 最新指示：先試圖片自動骨鏈，人工只作評分

使用者看過人工／直線骨鏈差異後要求優化，並確認先採圖片自動佈骨；人工中間關節、
骨長、權重及 Spine 網格不供生成器讀取，只供獨立評分。兩端與骨數仍可由人工給定。
新增圖片範圍目前為 **IN_DEVELOPMENT**；先前直線／精度 APPROVED 只留作歷史基線。
兩個 PNG-only 幾何候選均未優於兩例直線基線；當輪候選 Yuuna 36.05%、Panda
19.40% 的最大中間關節差均超過試驗用 5%。此 5% 尚非完整正式藝術驗收門檻。
20 項新增技術測試及獨立格式／數值檢查通過，不代表人工品質通過。
原核准直線引擎未修改，沒有新 Jev 呼叫、GitHub 推送或 Gate 5 開發。
詳見 [PNG-only 試驗紀錄](docs/research/GATE_4_IMAGE_CHAIN_TRIAL.md)；私有比較與截圖保留本機。

後續定位追查確認 Yuuna 原圖與人工加權姿勢不同、Panda 缺定位，原兩件仍未完成。
使用者確認改用其他本機完整定位骨鏈；按 PSD／匯入／PNG 與姿勢相容性篩查，
Plant01／Plant02 全數納入，不按候選分數挑案。植物批 0／2 未過 5% 工程草案：
Plant01 位置差由直線幾何基準 15.07% 降到 9.47%，Plant02 為 15.68%。
有限 heap 路徑搜尋修正後，21 項受影響的新定位測試通過；舊 Gate 沿用歷史證據。
詳見 [同姿勢骨鏈試驗](docs/research/GATE_4_SAME_POSE_TRIAL.md)，仍不是藝術／Jev 核准。

### 2026-10-03 最新流程修正：每一步驗收後才進下一步

使用者明確要求「每一步通過驗收之後才進下一步」，此規則也適用 Gate 內部子步驟。
目前停留在 **Gate 4 圖片骨鏈推定／人工對照返工**：Plant01 9.47%、Plant02 15.68%，
植物批位置工程試驗 0／2；21 項程式測試只作技術證據，不算此步驗收通過。
5% 仍是草案，骨長／方向藝術條件尚待核定，不得自行降低或跳過。

只允許針對此步失敗原因修正與必要重測；當前全部驗收條件及視覺證據確認前，
後續新能力、綁圖／權重、動畫與 Gate 5 均不開始。圖像定位、容量及新素材試驗僅保留為
探索／局部證據，不補標為正式步驟通過。待本機驗收完整通過，再按流程準備正式 Jev
資料包並另請送審授權；正式核准前不能宣稱圖片 Gate 已完成。
先前使用者明確指定「暫緩 Gate 3.2、先做 Gate 4」的順序例外仍保留，不能擴大至其他步驟。

### 2026-10-03 最新驗收範圍：承接 Gate 3.2 已通過的原 23 件

使用者要求 Gate 4 將 Gate 3.2 已通過的 23 個附件測試到通過，不能僅以另選的兩件部件作驗收。
已從 `collapse-20/report.json` 嚴格提取 `STATIC_CHECKS_PASSED` 的 23 件，核對本機原
Spine、4.0 新鮮匯出及 PNG 雜湊：Yuuna 14、Panda 4、Pig 5。
人工資料配置為 1 件三節髮絲骨鏈（F_Hair08）、14 件有長度單骨掛接、8 件零長度控制骨掛接；
不能將 23 個附件誤當成 23 條多節鏈或重複生成共享控制骨。

原四件探索案例（左辮子、Panda 尾巴、Plant01、Plant02）與此承接清單沒有交集，
故目前此基線 **Gate 4 測試 0／23、品質驗收 0／23**，不是 23 件已測試失敗。
這輪只完成來源查核、分類與凍結清單，不重跑 Gate 3.2，不跑新增骨架生成或 Jev。
當前步驟先確認此清單及各類驗收條件，再依逐步驗收規則逐件返工／測試／保存比較截圖；
資料不足或原型尚不支援保留為未完成，不能改成 N/A 消失。
5% 仍僅為多節骨鏈的位置工程草案，不能作為單骨及控制骨自動通過政策。
所有必要條件通過並正式核准前，不進 Gate 5、不自行擴大或縮小驗收分母。
詳見 [23 件承接清單與驗收計畫](docs/research/GATE_4_CARRYOVER_23_PLAN.html)。

### 2026-10-04 本機門檻獲同意與原 23 件前檢

使用者已同意採工程草案做本機驗收：骨數／父子／共享一致；多節關節最大差 ≤兩端距離 5%；
單骨／控制骨 pivot 最大差 ≤附件對角線 2%；有長度骨骼的骨長差 ≤10%、方向差 ≤5°；
圖片姿勢一致並提供人工／實際生成截圖。正式 Gate 通過仍需視覺確認與另經授權的 Jev，
不將此本機門檻批准等同於任何附件或 Gate 批准；取代上文「門檻待核定」的當前狀態。

原 23 件來源／能力前檢已核對 **23／23**：7 件定位與姿勢資料就緒；15 件缺可信定位／縮放證明；
F_Hair08 姿勢不同（最大頂點差 33.0137 世界單位）。既有 0.5 像素來源姿勢容差是前檢條件，
不是新骨架品質門檻。現有原型缺共享父骨／附件組裝，8 件控制骨不支援，10 件超過圖片原型容量；
原因重疊，不相加作附件件數。未讀人工關節／權重作生成輸入，也沒有執行新生成。

因此原 23 件 **生成骨架品質測試 0／23、验收 0／23**，停在當前前置步驟，不縮減分母。
新增 16 項前檢防誤判測試通過；保留原已通過 Gate 3.2／骨鏈證據，不重跑不受影響項目。
原引擎與 PNG 原型雜湊未改；本機逐件人工／來源截圖右欄明示 NOT GENERATED，
不能冒充人工／完成骨架比較或零誤差通過。未追加 Jev、推送或開始 Gate 5。
详見 [完整前檢結果與接續條件](docs/research/GATE_4_CARRYOVER_23_PREFLIGHT.md)。

### 2026-10-04 座標差判讀修正與必要輸入契約

使用者要求「做到通過為止」；原 23 件分母、已同意的門檻與逐步驗收規則不變。
新增評分端最小平方仿射診斷，23 件全部保留，22 件的頂點幾何可由單一全圖變換解釋。
F_Hair08 原位置比對的 33.0137 px 差主要是整圖座標差，對齊後殘差 0.0057 px；
不能沿用「差值證明真實彎曲／必須找新圖」的解讀。Char_LGT 同樣可由整圖尺寸／旋轉／定位解釋。
擬合只在評分端，未傳給生成器；不宣稱 22 件獨立定位已核定或骨架通過。

1_arrow 的原 PNG 含有人工排除的圖案。依同附件原 alpha >0 與人工 UV 三角形的交集，
原前景 22,072、使用 9,353、排除 12,719 像素；原圖不改、UV 重疊衝突 0。
可見使用區域的最佳仿射最大殘差 2.1334 px、RMS 0.9359 px，仍不滿足既有來源前檢 0.5 px；
不因透明頂點或排除區域便自動放行。這是附件／UV 對應差，不等於單骨真的彎曲。

新增 14 項診斷測試通過；測試寫法修正後只重測受影響的 1 項，其餘通過項目不重跑。
原核心與圖片骨鏈原型未改、原 23 件骨架生成品質測試／驗收仍 0／23。
當前必要決策：維持人工只評分並提供獨立定位／掛接意圖，或明示允許從人工 Spine 提取
整圖定位、父子／共享掛接及控制 pivot 作半自動已知輸入。中間關節、骨長與權重仍只評分，
明確供給的資料不能算 AI 自動辨識；在使用者確認之前不採用此輸入、不推進後續步驟。
未追加 Jev、推送或 Gate 5。詳見 [最新原因診斷與截圖](docs/research/GATE_4_REGISTRATION_DIAGNOSIS.md)。

### 2026-10-04 明確允許半自動輸入；先驗證隔離與同姿勢

使用者在輸入路線說明後回答「允許」。已更新本機政策及 HTML 計畫，准許整圖定位、父子／共享掛接、
控制 pivot，以及先前允許的端點／骨數；人工中間關節、骨長、權重與逐頂點變形仍只供評分。
原 23 件、工程門檻與逐步驗收規則不變，核准輸入不等於核准 Gate。

新增 17 項輸入契約測試與 8 項整圖定位數學測試，共 25 項通過，未重跑原已通過且未受影響的測試。
獨立檢查程序只讀 job 及核定 PNG，不讀 Spine 或人工評分資料；原 23 件身份與來源雜湊保留，
共享圖為 64 個唯一節點、10 個零長度控制 pivot，並非已生成 64 根骨骼。

本輪依明示平移／旋轉／縮放限制整圖輸入：同姿勢 17／23 就緒；5 件光效需整圖剪切，
箭頭在原始 unweighted mesh 的 UV／局部頂點對應已存在非仿射差。
原 22 件仿射診斷包含剪切，不能當作本輪 22 件就緒或骨架通過。箭頭最寬鬆全圖仿射在可見使用區域仍有 2.13 px。
當前同姿勢前置步驟未全過，品質測試／驗收仍 0／23，不擅自加入局部形狀輸入、降低容差或越級生成。
原核心、圖片骨鏈原型及來源未改，Gate 3.2 證據沿用；沒有新 Jev、推送或 Gate 5。
詳見 [半自動輸入驗證與比較截圖](docs/research/GATE_4_SEMI_AUTO_INPUT.md)。

### 2026-10-04 追加已知形狀／限定剪切；來源前置步驟完成

使用者另行允許 Pig 1_arrow 的人工附件形狀作明示已知輸入，以及限定 5 件 Yuuna 光效的整圖剪切。
原 23 件身份不變；箭頭新增核對後來源就緒 18／23，再只核對 5 件光效達到 **23／23 來源姿勢與輸入隔離就緒**，已就緒 18 件未重跑。
新增 11 項已知形狀及 6 項剪切防誤用測試通過。光效最大重建殘差約 0.00251 px，原 0.5 px 來源容差、骨架品質門檻不變。
這些是人工明示提供的圖像輸入，不證明自動辨識；人工中間關節、骨長、權重、正長度上下文父骨幾何仍只評分。
來源前置步驟完成，可進共享骨架生成開發；64 節點／10 控制 pivot 仍只是輸入圖。原 23 件骨架品質測試／驗收 **0／23、0／23**。
原素材、骨架核心及圖片原型未改，沒有新增 Jev、推送、綁圖、權重、動畫或 Gate 5。
詳見 [已知輸入前檢與截圖](docs/research/GATE_4_KNOWN_SHAPE_INPUT.md)。

### 2026-10-04 已知底座共享組裝；原 23 件本機數值通過

使用者另行允許 37 根非目標上下文父骨作明示人工提供底座（Yuuna 6、Panda 9、Pig 22）。
只限白名單身份；目標人工中間關節、骨長、權重仍不給生成器。共有 64 節點，37 根底座不算生成成果；10 個控制 pivot 已供給，17 根目標正長度骨由端點／圖片生成。
共享仿射組裝與 5 件官方 runtime 合成案例驗證後，首次真正生成原 23 件骨架並用官方 runtime 讀取量測。
首輪數值 22／23；後續只優化髮絲，61 個未受影響骨骼記錄與 22 件通過分數保留，不重測。
圖片截面中線與等弦長交點求解後，髮絲關節差 2.1213%、骨長差 5.2845%、方向差 4.5566°，全部原門檻通過。
最新原 23 件狀態為 **本機數值 23／23 通過，視覺確認與新增 Jev 待審**；已產生 23 張人工／實際生成對照及總表，不冒稱正式 Gate 通過。
沿用全部來源前檢與 Gate 3.2 通過證據；舊核心、原型、RigSpec、Gate 1、原素材未改；沒有新增 Jev、推送、綁圖、權重、動畫或 Gate 5。
詳見 [共享骨架本機數值結果](docs/research/GATE_4_SHARED_BASE_23.md)。

### 2026-10-03 歷史指示：將精度版進度推送 GitHub

使用者於 Gate 4 精度驗收及骨架截圖補充完成後，明確要求「將目前進度推送到 Github」。
此指示授權本次 source-only 進度快照，取代較早「等 Gate 3.2 完整通過後才推送」的本次發布限制；
不是 Gate 3.2 驗收通過或 Gate 5 開工授權。保留 Gate 3.2 暫緩 23／164、Gate 4 新版 APPROVED 的真實狀態。

目的地為既有私人 `Wayne188-yiching/AutoSpine` 的 `main`。提交前先讀取遠端、確認分支未分歧，
以明確檔案清單整理程式、測試、技術紀錄、Jev 裁決及可攜 Gate 4 骨架 HTML。
不納入原始 Spine／PNG／PSD／影片、私有對照圖、`docs/local-reviews/`、憑證或建置產物；
沿用未受修改影響的通過證據，不為發布重跑整套測試或呼叫 Jev。提交及推送後核對遠端 commit 與檔案清單。

| Gate | 狀態           | 開始       | Developer Verify | Jev Decision                                   | 備註                                                                        |
| ---- | -------------- | ---------- | ---------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| 0    | APPROVED       | 2026-09-23 | 2026-09-23       | APPROVED 0.88                                  | Jev 1.13；Evidence 3.94/4                                                   |
| 1    | APPROVED       | 2026-09-23 | 2026-09-23       | APPROVED 0.97                                  | Spine 4.0.64；18 tests、100 runs、Runtime/CLI 通過；Jev 複審核准            |
| 2    | APPROVED       | 2026-09-23 | 2026-09-23       | APPROVED 0.95                                  | PNG Parts 與 8-bit RGB PSD → AssetSpec；25 tests；Jev 2,739 tokens          |
| 3    | APPROVED       | 2026-09-23 | 2026-09-23       | APPROVED 0.98                                  | Tail alpha → MeshSpec；34 tests；實際 Tail.png 100 次一致；Jev 3,342 tokens |
| 3.1  | APPROVED       | 2026-09-23 | 2026-09-23       | APPROVED 0.95                                  | 參考 23 頂點；實測 24 頂點／27 三角形；35 tests；Jev 5,290 tokens           |
| 3.2  | REOPENED       | 2026-09-23 | 2026-10-03       | 新版未送審；舊版 APPROVED 0.87                 | 依使用者決定暫緩；23／164 靜態通過，115 拒絕、26 阻塞                       |
| 4    | IN_DEVELOPMENT | 2026-10-03 | —                | 直線精度歷史 APPROVED 0.98；新增圖片範圍未送審 | 同姿勢植物批 0／2；21 新分支測試通過；原辮子／Panda 未完成與直線核准保留    |
| 5    | NOT_STARTED    | —          | —                | —                                              | Gate 3.2 新版品質門檻未過，不得開始                                         |
| 6    | NOT_STARTED    | —          | —                | —                                              | Tail MVP 驗收點                                                             |
| 7    | NOT_STARTED    | —          | —                | —                                              | Arm MVP 驗收點                                                              |
| 8    | NOT_STARTED    | —          | —                | —                                              | 依賴 Joint baseline                                                         |
| 9    | NOT_STARTED    | —          | —                | —                                              | 依賴 Gate 8                                                                 |
| 10   | NOT_STARTED    | —          | —                | —                                              | 依賴 Gate 9                                                                 |
| 11   | NOT_STARTED    | —          | —                | —                                              | Engine MVP 驗收點                                                           |
| 12   | NOT_STARTED    | —          | —                | —                                              | Tail + Arm 通過後才開始                                                     |
| 13   | NOT_STARTED    | —          | —                | —                                              | 依賴 Gate 12                                                                |
| 14   | NOT_STARTED    | —          | —                | —                                              | Core 成熟後才引入 AI                                                        |
| 15   | NOT_STARTED    | —          | —                | —                                              | 依賴 Preview 與 AI Planner                                                  |
| 16   | NOT_STARTED    | —          | —                | —                                              | MCP 僅作 Adapter                                                            |
| 17   | NOT_STARTED    | —          | —                | —                                              | 最後建立 Skill                                                              |

本機 Gate 3.2 最近一次全量 region-15 審核（2026-10-01）：164 個案例中 138 個可生成；107 個頂點數 ±5 通過、24 個位置審核通過、138 個覆蓋通過、19 個全部靜態檢查通過；26 個阻塞、119 個拒絕。原 structure-11 的 18 個完整通過案例全部保留；目前 19 個完整通過案例各重跑 100 次，其餘各 2 次或生成受阻，不宣稱全語料 100 次驗收。程式完整檢查通過 156 項測試（18 個測試檔）。本輪以原圖與選用區域 alpha 分開約束，修正誤納人工排除前景；Astra 修正小數顯示座標造成的浮點誤覆，仍維持零誤納與 1.5 像素局部調整上限。粗搜尋亦使兩個原本未整體通過的案例改為區域預算阻塞，詳見 `docs/research/GATE_3_2_REGION_15.md`，沒有移除案例或放寬門檻。生成仍是人工參考限定，並非無參考辨識。獨立全語料前置審核拒絕，正式 Jev 未送審、GitHub 未推送。追加結構方案裁決用量 2,086 tokens（input 1,901、output 185），見 `docs/reviews/GATE_3_2_STRUCTURE_DECISION.json`；方案裁決不是驗收。完整報告與審核截圖留在 repo 外。新增教學素材僅輔助，不改變 164 個主案例分母。

Token 用量回補：Gate 0 的 Jev 驗收為 2,972 tokens（input 2,702、output 270）；Gate 1 的兩次 Jev 審查共 4,574 tokens（input 4,034、output 540）；Gate 2 的 Jev 審查為 2,739 tokens（input 2,469、output 270）；Gate 3 的 Jev 審查為 3,342 tokens（input 3,072、output 270）；Gate 3.1 的兩次 Jev 審查共 5,290 tokens（input 4,750、output 540）。這些數字**只包含 Jev**，不等於各 Gate 的完整開發用量。Codex 主代理與 Gate 3 Astra 子代理的逐 Gate 精確用量未提供，故記為「無法取得」，不填 0、不推算總數。Gate 1～3.1 細目見 `docs/reviews/GATE_1_REVIEW.json`、`docs/reviews/GATE_2_REVIEW.json`、`docs/reviews/GATE_3_REVIEW.json` 與 `docs/reviews/GATE_3_1_REVIEW.json`。

Gate 4 Token 用量：2026-09-24 歷史 Jev 驗收實測 input 2,318、output 270，合計 **2,588 tokens**，見 `docs/reviews/GATE_4_REVIEW.json`；2026-10-03 精度修補驗收另經本次授權呼叫一次，input **3,693**、output **270**，合計 **3,963 tokens**，見 `docs/reviews/GATE_4_PRECISION_DECISION.json`。兩次已記錄 Jev 用量合計 **6,551 tokens**，僅為審核成本；本輪 GPT-6.1 Sol High 開發代理與主代理精確用量無法取得，全 Gate 開發成本不能精確合計。歷史「未使用其他協作模型」只指 2026-09-24 那次實作，不代表本輪。

### 2026-09-30 執行順序與舊 GitHub 推送條件（歷史；本次發布已由 2026-10-03 最新指示調整）

使用者確認先完成現行 Gate 3.2 的有人工參考測試與正式 Jev 驗收，再整理本輪程式、測試與文件異動提交、推送 GitHub，然後才進行 Gate 4。單純程式回歸全過或 Jev 方案裁決完成，不觸發推送。無參考新圖盲測暫不加入本輪範圍。私人 Spine 原檔、圖像、影片、視覺證據與憑證不納入提交；保留其他工作區異動。

2026-10-02 最新 decimate-18 審核：164 件中 138 件生成；114 件點數通過、25 件位置通過、138 件覆蓋通過、22 件完整靜態通過，26 件阻塞、116 件拒絕。原 region-15 的 19 件通過全數保留，新增 panda 兩個手部與 pig 右腳；22 件各有 100 次一致生成紀錄。程式完整檢查 161 tests／19 files 通過。獨立全量前置審核仍拒絕（391 條失敗原因，非附件數），正式 Jev 未送審、GitHub 未推送。原始素材與匯出雜湊不變。詳見 `docs/research/GATE_3_2_DECIMATE_18.md`；減點依幾何面積與像素預算，不使用人工座標、邊索引或比對分數挑答案。

2026-10-03 最新增量 collapse-20：只重新生成 3 件受新增中點合併分支影響的失敗案例，其餘 161 件沿用已核對來源與隔離程式差異的證據；原 22 件通過沒有重跑。pig `1_arrow` 新增通過，13／13 點、位置誤差 2.8972%、漏覆 187／9353（1.9993585%，未放寬 2%）、人工排除區誤納 0，新增 100 次一致生成紀錄。合併證據為 23／164 完整靜態通過、26 阻塞、115 拒絕；獨立全量前置審核仍拒絕（389 條失敗原因）。本次只跑 1 個新測試與 1 個受影響的既有測試，皆通過；沿用歷史完整 161 項測試紀錄，不宣稱新版本重新跑過完整測試。詳見 `docs/research/GATE_3_2_COLLAPSE_20.md`，正式 Jev 未送審、GitHub 未推送。

2026-10-02 使用者補充：測試通過的項目不要無差別重跑。後續沿用未受修改影響的通過證據，只重測失敗案例與實際受影響的回歸項目；保留各次證據的來源／版本，不把舊版結果冒充新版實測。文件修改只檢查文件，不觸發完整程式測試。此指示不降低完整 Gate 品質門檻。

Gate 4 原定 GPT-5.6 Sol High，依 2026-10-03 使用者追加指示改用 **GPT-6.1 Sol High** 試跑，實際以指定模型的開發代理執行；不將主對話協調模型宣稱為已切換。必要時由 Astra 審查幾何設計，Jev 獨立驗收；其他 Gate 模型分工不變。依同日指示先進 Gate 4，不再等待 Gate 3.2 關閉。既有 Gate 4 是歷史核准基線，不宣稱它剛由本輪從零完成。綁圖、權重與動畫仍不屬於 Gate 4；模型試跑只檢查新案例，沿用未受影響的已通過測試。

GPT-6.1 Sol High 實際試跑：新極端數值輸入 `start=[1e16,0]`、`end=[1e16+4,0]`、`boneCount=256` 被接受，局部每節長 `0.015625`、總長 4 正確；獨立 double 世界座標累加還原終點卻停在起點，端點誤差 4。此為極大座標／極短分段的可表達精度缺口，不代表一般美術尺度骨鏈範例失敗；應另處理有效輸入域／數值承諾，不修改骨長或世界起點來湊結果。本次只有新案例稽核與文件，沒有修改引擎、重跑已過測試、呼叫 Jev 或推送 GitHub。詳見 [模型試跑紀錄](docs/research/GATE_4_SOL61_TRIAL.md)。

使用者隨後要求「把 Gate 4 優化到驗收通過」：本輪已開啟精度修補，以新版本的開發驗證及正式 Jev 審核為目標；歷史 APPROVED 0.96 不作為新版自動通過。先保存 [修補計畫與驗收頁](docs/reviews/gate-4-precision/review.html)，由指定 GPT-6.1 Sol High 開發代理實作最小數值檢查與定向回歸。只重測實際受影響案例；Gate 3.2、Gate 5 和 GitHub 推送條件不變。新增外部 Jev 資料包及額度使用須取得明確授權後才能送出。

### Gate 4 精度修補（2026-10-03，新版 Jev 正式核准）

- 狀態：`IN_DEVELOPMENT → DEV_VERIFIED → JEV_REVIEW → APPROVED`。本次送審前，使用者明確同意新資料包、目的地 `https://api.typesafe.ai/v1/systemone` 與 TypeSafe 額度使用；僅呼叫一次、未自動重試。
- 最小修補：原有退化輸入檢查之後，新增每個世界 joint／tip 的鏈長正規化精度檢查 ≤`1e-10`。不使用大世界原點放寬門檻，不改骨長、起點或 ID／父子契約；不可表達時回報 `RIG_NUMERIC_PRECISION`（stage=rig、severity=3）。這是 JavaScript Number 工程政策，不是 Spine 官方標準。
- 開發驗證：19 項定向 rig／CLI 測試通過，13 項新增審核門檻測試通過，build／typecheck／限定檔案 lint／format 通過。新成功輸出與新錯誤各與首次基準比較 100 次，完全一致。略過 13 個未受影響舊案例，其他 Gate 未變更通過證據沿用；未執行完整舊測試套件，未將歷史 69 tests 當成本輪實測。
- 獨立稽核：以不同於單元測試的 4 個新案例，獨立矩陣還原世界變換並對照舊核准提交 `5feda8a`。坍縮與「終點正確、途中失真」均明確拒絕；大座標可精確表達及一般斜向成功，接受輸出與舊版逐位元組相同。
- 正式 Jev：`jev-1.13.0`，2026-10-03 14:20（Asia/Taipei）；APPROVED probability **0.98**，六項 noul 為 **0.98／0.90／0.89／0.86／0.95／0.95**，Evidence Quality **3.99/4**，Primary Blocker **NONE**。全部原有硬門檻通過，沒有調低門檻。
- 證據：[送審資料包](docs/reviews/GATE_4_PRECISION_REQUEST.json)、[原始裁決](docs/reviews/GATE_4_PRECISION_DECISION.json)、[獨立稽核數值](docs/reviews/gate-4-precision/independent-audit.json)、[實作紅／綠燈紀錄](docs/research/GATE_4_PRECISION_IMPLEMENTATION.md)、[完整驗收紀錄](docs/research/GATE_4_PRECISION_ACCEPTANCE.md) 及 [驗收頁](docs/reviews/gate-4-precision/review.html)。舊核准 JSON 原樣保留。
- 本次核准僅為明確端點、直線等長骨鏈與數值拒絕政策。不代表圖片 joint／pivot 推定、綁圖、權重、動畫或 Spine 官方匯入／播放驗證。Gate 3.2 保留暫緩 23／164，Gate 5 未開始；未 staging、commit 或 push。

### Gate 4 歷史執行基線（2026-09-24 Jev 已核准；下列恢復紀錄早於精度修補）

- 2026-10-03 恢復工作：對照核准提交 `5feda8a`，Rig 套件、RigSpec、CLI 與骨鏈／套件邊界測試無差異；另以 TypeScript 的 ESM 編譯輸出對照現有 Rig 建置檔，排除示範使用不同來源的建置。未重跑原有通過測試、未追加 Jev 呼叫。現有 CLI 產生新範例 `(10,20) → (160,140)`、5 骨；獨立規格、父子順序、世界關節與終點檢查通過，關節最大誤差與終點誤差均為 0（此範例）。輸入、原始輸出與本輪紀錄見 [Gate 4 示範](docs/reviews/gate-4-resume/review.html)；不代表綁圖或動畫驗收。
- 明確的 `start`、`end`、`boneCount` 輸入，產生 schema-valid `RigSpec` 直線等長骨鏈；根骨使用世界起點與朝向，子骨使用相對父骨的局部位移及零局部旋轉，parent-first 排序。Gate 4 不從圖片推測關節或自動綁定 Mesh，也不提前實作權重／動畫。
- 獨立正向運動學測試覆蓋水平、向上、斜向與反向，逐節核對 world joint 與終點；11 種退化輸入回傳 rig-stage 結構化錯誤。CLI 不覆寫輸入或既有輸出；固定輸入 100 次序列化完全一致。
- `npm run verify`：格式、lint、build/typecheck 與當時 69 tests／9 files 全過，包含先前 50 個測試。Jev `jev-1.13.0` 於 2026-09-24 核准，APPROVED probability 0.96、tests credible 0.86、evidence quality 3.95/4。後來 Gate 3.2 因使用者提高人工網格品質門檻而重開；Gate 4 骨鏈驗收紀錄保留，但 Gate 5 必須等 Gate 3.2 重新過關。

### Gate 3 執行基線（Jev 已核准）

- Astra High 子代理僅提出設計與測試判準，未修改程式；主代理實作 deterministic mesh，Jev 仍是正式驗收者。
- 輸入：Gate 2 `AssetPart.alphaMask` 的非零 alpha 與顯示 bounds；輸出：既有 `MeshSpec-0.1`，不改 Schema。
- 最小方法：4-connected 單一區塊、像素邊界、精確共線簡化、Earcut 候選三角形、內部頂點、獨立 Mesh Validator。固定輸入須固定輸出。
- 嚴格模式拒絕孤立區、角點 pinch 與孔洞；選用前處理必須由呼叫者設定總變更像素比例上限並記錄捨棄與填補數量，不默默丟圖。
- 私有實測素材選用喵助 `Tail.png`（294×530，SHA-256 `B62426BE390AD824DB5A691C63B9E38A61DB52405BD5AF105164C2E48BF8B7F6`），不提交原圖或導出網格。0.5% 總變更預算下排除孤立像素 154、補角點 1、補 5 個單像素孔洞，產生 1,214 vertices／1,476 triangles，最小／最大三角形面積 0.5／504 pixel²；100 次額外產生的序列化完全相同。此結果是結構與確定性證據，不宣稱已有藝術品質或變形驗收。
- 未涵蓋：骨骼、權重、關節感知拓樸、動畫、Spine mesh 序列化與正式視覺 Preview；這些必須留待後續 Gate。

### Gate 3.1 Mesh 參考佈線修正（Jev 複審核准）

- 使用者提供的 Spine 尾巴截圖顯示 23 個頂點、稀疏外輪廓與沿尾巴走向的內部頂點。首次 334 頂點版本雖獲 Jev 初審核准，對照此參考仍過密，因此以同一 Gate 複審，並保留初審紀錄。
- 使用同一張私有喵助 `Tail.png` 與同一個 0.5% alpha 前處理預算，輪廓由 950 降至 19 個頂點，內部採五個等距截面中點；總頂點由 1,214 降至 24，三角形由 1,476 降至 27。新網格獨立拓樸驗證通過，100 次額外生成完全一致。
- 閉合輪廓簡化有自交防護；修正後 81,641 個前景像素中漏覆 1,297（1.589%），多覆背景 306（0.375%），各低於長形低頂點素材的 2% 門檻。27 個三角形都沒有小於 10° 的最小角；最大面積 5,565.625 pixel²。前後對照圖已本機檢查，私有原圖、參考截圖與導出圖／網格均不提交。
- 可攜的 240×320 曲線素材測試驗證 ≤32 頂點、至少五個內部點、輪廓覆蓋率、三角形品質與固定輸出；全套 35 tests 通過。這仍是靜態 MeshSpec，並非與人工 23 頂點專案逐頂點相同，也不宣稱骨骼彎曲品質或 Spine 編輯器驗收；Gate 6 才驗證動態變形。完整證據見 `docs/reviews/GATE_3_1_REVIEW.json`。
- 後續 AWP 實際 `.spine` 抽樣顯示此尾巴專用密度規則尚無法泛化到人物與 Symbol：同圖附件的人工作品／AutoSpine 頂點數分別為鬍鬚 24／51、頭部 80／34、房屋 Symbol 25／275。此補充測試不改變原本的尾巴限定核准，但擴大素材範圍前必須修正密度策略並重新交 Jev 驗收；方法與限制集中記於 `docs/reviews/GATE_3_1_AWP_FIELD_TEST.md`。

### Gate 3.2：以人工佈線為標準的靜態網格密度（新版門檻待返工）

#### 2026-09-24 新增人工位置與實線／虛線硬門檻

- 使用者將點數限制由 ±20% 改為 **±5%**，每個頂點相對同圖人工原檔的配對距離須 ≤圖片對角線 **5%**；外框連線和人工指定的內部實線須 **100%** 保留，自動產生的三角剖分虛線須至少 **80%** 相符。外框與內部點分開配對；點數允許 ±5% 時，多餘或缺少的點也須在距離門檻內。每個素材獨立判斷，不互相平均。
- Spine 4.0.64 匯出的 `triangles` 是實際影響變形的剖分；編輯器以灰色虛線顯示其自動內部邊。`edges`（開啟 nonessential export 時）記錄外框與人工指定連線；扣除外框後才是橘色實線。虛線不是「不存在的邊」，但不能冒充人工指定實線。缺少 `edges` 匯出時，此項比較標記 `BLOCKED`，不可把空值誤判為零條實線。依 [Spine 官方 Mesh 說明](https://esotericsoftware.com/spine-meshes#Edges) 和 [JSON 格式](https://esotericsoftware.com/spine-json-format)。
- 用相同 PNG、skin／slot／attachment 重新量測：鬍鬚人工內部實線 0、虛線 21；房屋人工內部實線 14、虛線 20。兩者點數均相同，但每點最大配對距離分別為圖片對角線的 15.77% 與 32.15%；鬍鬚／房屋虛線相符率僅 38.10%／25.00%，房屋人工實線保留率 0%，外框相符率 87.50%／52.63%。因此兩者均 **REJECTED**，不能以舊版 Jev 核准或平均最近距離宣稱及格。詳見 [新版拓樸重驗證紀錄](docs/reviews/GATE_3_2_TOPOLOGY_REOPEN_20260924.json)。
- 這是新版規則的本機硬門檻失敗，**未呼叫 Jev**；本次 Jev token 為 0（未送審），主開發模型逐 Gate 精確用量無法取得。返工時必須讓 `MeshSpec`／後續 Adapter 能明確表示人工實線，而不只輸出 `triangles`；修正後重跑同檔量測、完整回歸及 Jev 複審。Gate 5 暫停。

#### 歷史：2026-09-23 舊版 ±20% 規則與核准（已被新版門檻取代）

**當時生效、現在已被取代的規則**：使用原始 `.spine` 的同一 skin／slot／attachment 與同一 PNG 作為人工標準；當時的頂點數雙向相對誤差 `abs(生成 − 人工) / 人工 ≤ 20%`。允許整數區間為 `ceil(人工 × 0.8)`～`floor(人工 × 1.2)`。2% 輪廓誤差門檻仍有效，但現在另有更嚴格的位置與佈線條件。

- 每個指定實測附件都須逐一通過，不可平均抵銷、刪除失敗樣本，或因標成 rigid 就豁免。缺少可核對人工基準則 `BLOCKED`，不能自行猜點數。Tail 截圖 23 點目前只能作參考，不冒充同檔人工基準。
- 點數檢查是送 Jev **之前的程式硬門檻**；未通過不呼叫 Jev，Jev 的機率與其他分數不能覆蓋此結果。通過後仍須核對人工邊流、外框／內部點分布、特徵保留與三角形品質；不得靠任意補點湊到及格數。Jev 新增人工佈線證據問題，機率同樣需 ≥0.8。
- 返工前鬍鬚人工 24／生成 25（+4.17%）、房屋人工 25／生成 11（−56%）。該階段曾因本機硬門檻改列 `REJECTED`，不代表 Jev 曾回覆 REJECTED。修正與正式複審過程完整保留於歷史審查 JSON。

#### Gate 3.2 最終修正與驗收（2026-09-23）

- 使用相同 `.spine` 附件與 PNG 取得人工頂點總數、外框點數及內部點的無單位截面高度／展開比例；Mesh 引擎據現有 PNG 的不透明區重算幾何。私人解析只在開發工具，Mesh 不匯入 Spine，也未變更 IR Schema 或 runtime dependency。開發工具輸出的 `<id>.profile.json` 可由 `mesh-png`／`mesh-asset` 以 `--reference-profile` 使用；在實際房屋 PNG 上，CLI 的每個頂點、UV、三角形與外框索引均與參考檢查器結果相同。

| 同圖素材          | 人工頂點（外框／內部） | 生成頂點（外框／內部） | 漏覆前景 | 多覆背景 | 與人工頂點位置平均最近距離 |
| ----------------- | ---------------------: | ---------------------: | -------: | -------: | -------------------------: |
| 鬍鬚 `huzi2`      |            24（24／0） |            24（24／0） |  1.8141% |  1.8141% |               外框 2.82 px |
| 房屋 `SC_House_B` |            25（19／6） |            25（19／6） |  0.2170% |  0.8197% | 外框 5.34 px、內部 2.82 px |

- 房屋內部點的平均最近距離由最初等距佈線的 43.93 px 降至 2.82 px；鬍鬚與人工一樣只有外框點。局部邊線與三角形角度仍不同，鬍鬚有四個低於 10° 的三角形，需後續人工與動態驗證。這次只核准靜態拓樸，不核准動畫變形。
- 三個私人素材各 100 次輸出完全一致；不附人工參考時，鬍鬚、房屋與尾巴完整 MeshSpec 序列化均與返工前保存版本完全相同。獨立網格驗證、可攜合成素材及 CLI 整合測試通過；`npm run verify`：格式、lint、型別與 **50 tests／7 files** 全過。
- Jev 舊規則核准與所有未達門檻的複審原樣保留，最後一次於 [Gate 3.2 最終複審](docs/reviews/GATE_3_2_RECHECK_5.json) 決定 `APPROVED`：批准機率 0.87、人工佈線 0.85、測試可信 0.83、回歸安全 0.86、架構 0.92、證據品質 3.97/4、Primary blocker NONE。共六次正式 Jev 呼叫（含舊規則初審）：input **21,455**、output **1,715**、total **23,170** tokens。本次 Codex 主代理 input/output **無法取得**；其他協作模型**未使用**；整 Gate 無法精確合計。未通過本機前置檢查的測試沒有呼叫 Jev，也沒有計入 Jev 用量。
- 歷史版本曾達到 Gate 4 前置條件；最新指示已重開 Gate 3.2，以 Yuuna／panda／pig 為主、Tutorial 為輔。新證據未獲 Jev 核准前，不進 Gate 4。

以下為首次開發計畫的歷史紀錄；其中一側 1.5 倍點數上限與後來的 ±20% 雙向上限均已失效，現行規則以上述 2026-09-24 新版門檻為準。

新規則驗證：`npm run verify` 通過格式、lint、型別及 46 tests／7 files。新增測試涵蓋雙向門檻內外、整數上下限、缺少基準、房屋失敗，以及真實審查程序在載入 SDK／呼叫 Jev 前拒絕超標附件。測試通過代表驗收規則有效，不代表待修的房屋網格及格。

- **目的與順序**：在 Gate 4 前修正 Gate 3.1 尾巴專用規則對其他形狀的誤用。輸入仍是 Gate 2 的 PNG／`AssetPart`，輸出仍是合法且 deterministic 的 `MeshSpec`；人工 `.spine` 網格用來建立對照與驗收，不逐頂點複製，也不把兩個專案訓練成通用 AI 模型。沿用 Gate 3 的 Astra 設計、Sol 實作分工，Jev 為獨立驗收者；不改動已定的其他 Gate 模型分配。
- **先量測再訂規則**：以相同 PNG、alpha 清理預算與座標，量測人工外框的漏覆／多覆、頂點／三角形、內部點、骨骼影響與 deform timeline。移除重複附件對統計的偏重；保留 `.spine`／PNG 雜湊，私有原圖、導出 JSON 和網格不進 Git。人工檔是參考而非無條件正解；不能只以頂點總數判定佈線品質。
- **實作範圍**：用輪廓曲率、同圖像素覆蓋誤差與可編輯點數預算替代單一長寬比分流；內部點依可得的用途提示區分「近乎剛性」與「待變形」，不再讓近方形 Symbol 固定鋪滿網格。簡化後仍檢查自交、三角形品質與獨立 Mesh Validator。若沒有足夠的用途資訊，明確標示需複查，不能猜測已達動畫級品質。AI 不直接決定幾何位置。
- **私人 AWP 回歸門檻**：對同圖 `huzi2`（人工 24、目前 51）及 `SC_House_B`（人工 25、目前 275），AutoSpine 各自降至不超過人工頂點數的 1.5 倍，並且相同前處理後的前景漏覆／背景多覆各 ≤2%；若人工原網格本身超過此覆蓋預算，先揭露差異並送人工判定，不可硬削點數或暗中更改門檻。保留 `Tail.png` 的 Gate 3.1 覆蓋與拓樸基線；增加可提交的合成小型長形／寬形素材測試，讓沒有 AWP 權限的電腦仍可回歸。
- **不得提前宣稱完成的部分**：`tou_1_3` 人工 80 點、目前 34 點，且有加權及 `Idle` deform timeline。Gate 3.2 僅記錄這個未解決案例、避免把五個中線點標為已驗收的頭部網格；Gate 4–5 才提供骨骼與權重資訊。Gate 6 依原計畫建立尾巴動態量測方法，不能以尾巴通過代替頭部驗收；頭部專項須在後續人物擴充 Gate 12 或另設子 Gate，以其動畫姿勢量測拉伸、翻面與破綻。Gate 3.2 不輸出骨骼、權重、動畫，也不承諾 Spine 成品美術核准。
- **關閉條件**：新增可攜回歸與 AWP 私有實測證據；所有既有 Gate 0–3.1 測試通過，獨立拓樸驗證通過，固定輸入至少 100 次輸出完全相同；提供同素材人工／生成佈線可檢視對照及失敗案例。Jev 依本段範圍與數據審查，未 `APPROVED` 不進 Gate 4。完成時記錄所有開發與 Jev 複審的實際 Token 用量；不可取得者明示，不填 0。

本次執行由使用者指定的 GPT-6 Astra 主代理負責設計與實作，未啟用額外子代理；Jev 仍負責獨立驗收。這是本 Gate 的執行選擇，不改動其他 Gate 已定分工。

#### Gate 3.2 首次實作與舊規則審查紀錄（2026-09-23，已被新門檻取代）

- **方法**：以固定次序刪除低曲率冗餘輪廓點，每次檢查累積覆蓋誤差、自交及原輪廓距離。新增呼叫端用途 `chain`／`rigid`／`unknown`；不由檔名猜用途。剛性物件不灌內部點；已指定 chain 才使用五個截面候選點，仍非關節感知佈線。未知用途產生稀疏幾何草稿並提示複查。小型 golden 行為保留，較大素材使用相對面積預算，避免圖片解析度驅動點數爆增。
- **人工差異與決定**：人工鬍鬚與房屋網格的透明背景多覆分別為 24.7166%／3.2225%，前景漏覆為 0%／0.0136%。使用者明確決定「維持 2%，人工網格作參考」；生成門檻未放寬，不把透明 padding 說成圖片損壞。

| 同圖素材                 | 人工頂點 | Gate 3.1 頂點 | Gate 3.2 頂點（外框／內部） | 三角形 | 漏覆前景 | 多覆背景 | 小於 10° 三角形 |
| ------------------------ | -------: | ------------: | --------------------------: | -----: | -------: | -------: | --------------: |
| 鬍鬚 `huzi2`，chain      |       24 |            51 |                 25（20／5） |     28 |  1.9274% |  1.9274% |               2 |
| 房屋 `SC_House_B`，rigid |       25 |           275 |                 11（11／0） |      9 |  0.2868% |  1.0270% |               1 |
| 原 `Tail.png`，chain     |  截圖 23 |            24 |                 24（19／5） |     27 |  1.5887% |  0.3748% |               0 |

- **驗證**：格式、lint、型別、build 與 41 tests／6 files 通過；CLI 實測確認參數、未知用途警示、輸入保護與拒絕覆寫。三個私有素材各 100 次生成序列化完全一致，獨立拓樸驗證通過；可攜小曲線、不同尺寸剛性矩形也有 100 次回歸。原 Tail 覆蓋與點數完全保留。私人來源、Spine 導出、網格與對照圖皆留在 Git 之外。
- **視覺限制**：已檢視同素材人工／舊版／新版精確座標對照。鬍鬚仍有兩個細長三角形、內部集中連線，並非人工的純外框條帶結構；房屋只限明確剛性用途，不能宣稱可變形。所有診斷皆標記 `DEFORMATION_NOT_VERIFIED`，未知用途另報 `INTENT_UNKNOWN`。頭部 deform 尚未解決；Gate 6 仍只驗尾巴，頭部留後續 Gate。這次核准的是靜態密度修正，不是美術成品或動畫驗收。
- **Jev**：`jev-1.13.0` 一次正式送審，`APPROVED` 0.94、Evidence 3.95/4、Primary blocker NONE，全部強制门檻通過；完整量測與審查見 [GATE_3_2_REVIEW.json](docs/reviews/GATE_3_2_REVIEW.json)。
- **Token 用量**：Jev 實測 input **3,631**、output **270**、total **3,901**。Codex 主代理逐 Gate input／output／total **無法取得**；其他協作模型**未使用**；全 Gate **無法精確合計**，不能以 Jev 用量代替完整開發成本。
- **下一步（更新）**：依人工拓樸標準返工 Gate 3.2，重跑雙向點數硬門檻、輪廓與佈線檢查後，以新證據送 Jev；不可進 Gate 4。歷史 Jev 用量 3,901 保留，本次規則更新未呼叫 Jev，主代理精確用量仍無法取得。

## 13. Gate 0 歷史範圍與下階段規則

歷史上 Gate 0～4 曾各自核准；Gate 3.2 因更嚴格的人工位置與連線門檻重開，目前依使用者決定暫緩，先處理 Gate 4；Gate 5 仍未開始。下列內容是 Gate 0 的歷史範圍，不改變第 12 節的現行順序：

1. 建立 Repository 與 TypeScript workspace。
2. 建立 lint、formatter、test、build scripts。
3. 建立必要 packages、schemas、fixtures 和 tests 骨架。
4. 建立 README、ARCHITECTURE、ROADMAP、ASSUMPTIONS、BACKLOG。
5. 建立 ADR-001～ADR-006。
6. 建立 AssetSpec、MeshSpec、RigSpec、WeightSpec、ConstraintSpec、AnimationSpec、ValidationReport 初始型別與 Schema。
7. 建立 Gate 1 計畫。
8. 完成 Developer Verification。
9. 送交 Jev 驗收。
10. 收到 Jev 決定後停止；即使 APPROVED 也不自行開始 Gate 1。

Gate 0 明確禁止：Mesh、Weight、AI、MCP、Skill、GUI、Gate 1 Compiler implementation。

## 14. Jev 技術整合

### 14.1 已確認的來源

Jev 的獨立測試環境位於：

```text
D:\Wayne\JevTest
```

該環境已包含 SDK、`.env`、README 與 smoke test。AutoSpine 不讀取、複製或提交 `.env`；API key 只透過 `TYPESAFE_API_KEY` 交給 SDK。

### 14.2 AutoSpine 邊界

- Jev 是開發期驗收工具，不是 AutoSpine Engine dependency。
- Core、Mesh、Rig、Weight、Animation、Spine Adapter 都不得 import Jev SDK。
- Jev adapter 放在 repository 的開發工具區，而不是 `packages/core`。
- Jev 收到的是整理後的 Gate Review Bundle，不是未篩選的整個工作目錄。
- 預設 `TYPESAFE_LOG_LEVEL=warn`，避免 debug log 記錄完整 request body。
- 驗收結果記錄 model、token usage、問題、答案、機率、門檻與最終判定；不得記錄 API key。

### 14.3 建議的 Gate Review State

送給 Jev 的 `state` 使用 JSON-compatible object：

```json
{
  "project": "AutoSpine",
  "gate": 0,
  "objective": "...",
  "inScope": ["..."],
  "outOfScope": ["..."],
  "changedFiles": ["..."],
  "assumptions": ["..."],
  "implementationSummary": "...",
  "checks": [{ "name": "build", "status": "passed", "evidence": "..." }],
  "metrics": {},
  "compatibilityEvidence": ["..."],
  "knownLimitations": ["..."],
  "definitionOfDone": [{ "criterion": "...", "status": "passed", "evidence": "..." }]
}
```

不要把大型 log、二進位素材或整份原始碼塞入 state。只傳可驗證摘要、必要片段和 repository 內的證據路徑。若 Jev 無法直接讀 repository，摘要必須包含判定所需的最小證據內容，不能只提供路徑。

### 14.4 執行與保存

正式流程會建立一個最小 Jev review runner，責任僅限：

1. 讀取 Gate Review Bundle。
2. 建立固定 Choice／Noul／Score 問題。
3. 呼叫一次 `systemOne`。
4. 套用本文件的批准門檻。
5. 保存不含秘密的 JSON 結果。
6. 以 exit code 表示 APPROVED、REJECTED、BLOCKED 或 transport error。

Transport error、authentication error 或 rate limit 不等於 REJECTED，也不得視為 APPROVED；狀態保持 `JEV_REVIEW` 或轉成 `BLOCKED`。只允許 SDK transport policy 的正常 retry，不得因不喜歡 Jev 結果而反覆抽樣直到通過。

### 14.5 尚待第一次實作時確認

只有一項整合決策尚未定案：Jev runner 是保留在獨立 `D:\Wayne\JevTest`，還是以 dev-only 工具加入 AutoSpine repository。預設採用後者，因為可版本化 Gate 問題和批准門檻；API key 仍只保存在環境變數或被忽略的本機 `.env`。

## 15. 每回合回報格式

```text
Gate:
Status:

Completed:
- ...

Verification:
- ...

Jev:
- NOT_SUBMITTED | APPROVED | REJECTED | BLOCKED

Token usage (Gate 完成時必填):
- Codex/主開發模型：input、output、total；來源與「實測／估算／無法取得」
- Jev：input、output、total；包含所有正式送審與修正後複審
- 其他協作模型：逐模型列示；沒有使用則填「未使用」
- 全 Gate 總計：僅在各項均有可靠數據時填數字，否則填「無法精確合計」

Risks / assumptions:
- ...

Next allowed action:
- ...
```

這份回報只摘要結果；完整流程與狀態仍回寫本文件，避免散落在對話中。

### Gate 4 · 人工拆圖自動推定目標骨（2026-10-04）

使用者已確認新模式：目標端點、骨數、類型、控制 pivot 與關節不得由人工目標骨提供；已知組裝底座保留，不算自動生成。
25 項新輸入隔離、圖片幾何及候選組裝測試通過；20 張人工 PNG 只各推定一次，原 23 件有 12 件實際候選、11 件不確定，骨架門檻 0／23 通過。
完整共享骨架未完成，停在本步改善，不進 Gate 5。原半自動 23／23 是不同輸入模式的歷史，不轉移成新模式通過。
新模式 [逐件比較與截圖](docs/local-reviews/gate-4-png-target-07/review.html?view=summary) 及 [结果與限制](docs/research/GATE_4_PNG_TARGET_BASELINE.md) 已存入專案。
沒有 GitHub 推送；原 Spine／PNG、Gate 3.2 及半自動證據未重跑／修改。本輪開發精確 Token 用量無法取得，不以可見文字估算。

2026-10-04 經本次明確授權，已將核准彙總資料送 Jev 設計裁決一次（`jev-1.13.0`），沒有原圖、Spine 檔、人工座標或權重。選擇 B：RGB 物件／區域與用途提案，再做數學定位（選擇機率 0.99）；先驗證輸入隔離與歧義拒判（0.94）；裁決僅支持有限實驗、不是正式 Gate 驗收（0.99）。新模式仍 0／23，RGB／用途模型尚未實作，不進 Gate 5。
原核准請求不改寫；[實際 API 請求](docs/reviews/GATE_4_PNG_TARGET_DESIGN_API_REQUEST.json)、[原始裁決](docs/reviews/GATE_4_PNG_TARGET_DESIGN_DECISION.json)、[提交核對](docs/reviews/GATE_4_PNG_TARGET_DESIGN_RECORD.json) 及 [下一個有限實驗](docs/research/GATE_4_ARTIST_SPLIT_INPUT_PLAN.html#jev-design) 已存入專案。
本次 Jev 實測 input **1,663**、output **194**、total **1,857 tokens**，只屬設計審查成本，不代表完整 Gate 開發成本。對付費語意模型或原圖外傳仍需新授權。

使用者要求進下一步後，RGB 輸入隔離與歧義預檢的本機程序檢查已通過：新增輸入契約 17、像素證據 7、獨立程序 7，共 **31 項**。真實組裝／人工參考／評分三份檔案都被同一讀取權限清單拒絕。20 張原 PNG 只各分析一次，11 張單連通區、9 張多連通區；映射回原 23 件為 12／11。連通區不等於物件，全部骨骼用途仍未知，未選區域、未生成新骨架；原新模式 **0／23** 量測及舊通過證據未重跑。
[本步結果](docs/research/GATE_4_RGB_BOUNDARY_STEP.md)、[23 件 RGB 預檢與截圖](docs/local-reviews/gate-4-rgb-boundary-08/review.html?view=summary)、[公開彙總](docs/reviews/GATE_4_RGB_BOUNDARY_RESULT.json) 已存回專案。原圖、量測與截圖不進 Git；沒有新 Jev、付費模型、原圖外傳、Gate 5 或推送。本輪精確開發 Token 用量仍無法取得。

經使用者同意下載，本機 CLIP ViT-B/32 q8（固定 revision、Transformers.js 3.8.1／CPU）類別實驗已完成。新增 **22／22** 提案契約及網路／隔離測試通過，先合成試跑，再分析原 20 張 PNG。模型只收全圖像素与預先固定的 13 類，不收名稱或人工骨架答案；三份真實人工／組裝／評分檔的 JS 讀取均拒絕。遠端模型停用且應用層網路入口阻擋，不宣稱可信任原生套件受 OS 級隔離。

40 次類別提案有 **10 張黑白首選一致、10 張背景敏感**；映射回原 23 件為 10／13。一致不能算正確率，髮絲、地面及細繩有錯誤或用途不明的提案，因此**此版不採用作自動建骨**。沒有遮罩、用途或新骨架；原 **0／23** 量測不重跑，半自動歷史、門檻及原檔保留。套件＋模型約 547.5 MB，根依賴未改；40 次推論含載入約 3.16 秒、峰值 RSS 約 821 MiB，僅單輪量測。模型已 dispose。無付費 API、原圖外傳、新 Jev、Gate 5 或推送。

[本輪結果與接續條件](docs/research/GATE_4_LOCAL_CATEGORY_EXPERIMENT.md)、[23 件類別提案與截圖](docs/local-reviews/gate-4-local-semantic-09/review.html?view=summary)、[公開彙總](docs/reviews/GATE_4_LOCAL_CATEGORY_RESULT.json)。原圖、每圖分數、套件／權重及四張新截圖只留本機；已檢視全部輸入縮圖與兩個重點案例，但不等於使用者視覺驗收。下一步需先解決區域定位與物件辨識品質，通過後才接建骨，不能按本批答案調骨數。

Gate 0～17 每階段完成時，都要在最終回報與 Gate 紀錄附上該階段的 Token 用量。計算範圍從開始該 Gate 到 Jev 最終決定，包含返工與複審；不可只列最後一次呼叫。優先採用模型或工具提供的實際 input/output usage；若無逐 Gate 精確數據，明確寫「無法取得」，有可重現估算方法時才能另外標示「約」，不得把估算寫成實測。cached input 已包含在 input tokens、reasoning tokens 已包含在 output tokens，不重複加總；可見文字也不能反推完整 output 用量。見 [OpenAI 官方 Token 計數說明](https://developers.openai.com/api/docs/guides/token-counting)。
