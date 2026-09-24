# AutoSpine 集中式開發與 Jev 驗收流程

版本：0.2  
狀態：流程已定義；Jev SDK 介面已由 `D:\Wayne\JevTest` 驗證  
適用範圍：Gate 0～17

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
4. 一次只開發一個 Gate；未通過 Jev 驗收不得進入下一 Gate。
5. 每次只做達成當前 Gate 所需的最小改動。
6. 不建立尚未被當前 Gate 使用的抽象、設定或擴充點。
7. 不用 TODO、假 Solver、永遠通過的 Validator、硬編碼 Fixture 結果宣稱完成。
8. 不確定的 Spine 格式、幾何或權重演算法先研究，明確區分 Known、Assumption、Experimental、Verified。
9. 同一份 Input + Spec + Config + Seed 必須得到相同輸出。
10. 幾何品質同時使用量化指標和視覺檢查，不以「看起來可以」作為唯一結論。
11. 涉及人工 Mesh 對照的驗收，以原始同檔附件的人工佈線為標準：逐附件頂點數雙向誤差不得超過 ±20%，超標即不及格；數量通過仍須檢查邊流與內外點分布，不得靠湊點數過關。Gate 3.2 已加入程式硬門檻，後續涉及 Mesh 的 Gate 必須沿用，不得只用 Jev 整體分數覆蓋。

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
| 3.2  | AWP 人物小部件與 Symbol 的靜態 Mesh 密度修正        | 同圖 `.spine` 網格對照、輪廓覆蓋、拓樸與固定輸出回歸        | 鬍鬚／房屋不再過密且不犧牲可接受輪廓；尾巴基線不退化；不宣稱頭部動態變形已通過                                  | 沿用 Gate 3 分工；Jev 驗收 |
| 4    | Deterministic ChainRigTemplate                      | 骨長、位置、旋轉、parent 單元測試                           | start/end/boneCount 產出正確 chain；退化輸入有明確錯誤                                                          | GPT-5.6 Sol High           |
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

| Gate | 狀態        | 開始       | Developer Verify | Jev Decision  | 備註                                                                        |
| ---- | ----------- | ---------- | ---------------- | ------------- | --------------------------------------------------------------------------- |
| 0    | APPROVED    | 2026-09-23 | 2026-09-23       | APPROVED 0.88 | Jev 1.13；Evidence 3.94/4                                                   |
| 1    | APPROVED    | 2026-09-23 | 2026-09-23       | APPROVED 0.97 | Spine 4.0.64；18 tests、100 runs、Runtime/CLI 通過；Jev 複審核准            |
| 2    | APPROVED    | 2026-09-23 | 2026-09-23       | APPROVED 0.95 | PNG Parts 與 8-bit RGB PSD → AssetSpec；25 tests；Jev 2,739 tokens          |
| 3    | APPROVED    | 2026-09-23 | 2026-09-23       | APPROVED 0.98 | Tail alpha → MeshSpec；34 tests；實際 Tail.png 100 次一致；Jev 3,342 tokens |
| 3.1  | APPROVED    | 2026-09-23 | 2026-09-23       | APPROVED 0.95 | 參考 23 頂點；實測 24 頂點／27 三角形；35 tests；Jev 5,290 tokens           |
| 3.2  | APPROVED    | 2026-09-23 | 2026-09-23       | APPROVED 0.87 | 人工／生成鬍鬚 24／24、房屋 25／25；50 tests；Jev 累計 23,170 tokens        |
| 4    | APPROVED    | 2026-09-23 | 2026-09-24       | APPROVED 0.96 | 直線等長骨鏈；69 tests；100 次一致；Jev 2,588 tokens                        |
| 5    | NOT_STARTED | —          | —                | —             | 依賴 Gate 4                                                                 |
| 6    | NOT_STARTED | —          | —                | —             | Tail MVP 驗收點                                                             |
| 7    | NOT_STARTED | —          | —                | —             | Arm MVP 驗收點                                                              |
| 8    | NOT_STARTED | —          | —                | —             | 依賴 Joint baseline                                                         |
| 9    | NOT_STARTED | —          | —                | —             | 依賴 Gate 8                                                                 |
| 10   | NOT_STARTED | —          | —                | —             | 依賴 Gate 9                                                                 |
| 11   | NOT_STARTED | —          | —                | —             | Engine MVP 驗收點                                                           |
| 12   | NOT_STARTED | —          | —                | —             | Tail + Arm 通過後才開始                                                     |
| 13   | NOT_STARTED | —          | —                | —             | 依賴 Gate 12                                                                |
| 14   | NOT_STARTED | —          | —                | —             | Core 成熟後才引入 AI                                                        |
| 15   | NOT_STARTED | —          | —                | —             | 依賴 Preview 與 AI Planner                                                  |
| 16   | NOT_STARTED | —          | —                | —             | MCP 僅作 Adapter                                                            |
| 17   | NOT_STARTED | —          | —                | —             | 最後建立 Skill                                                              |

Token 用量回補：Gate 0 的 Jev 驗收為 2,972 tokens（input 2,702、output 270）；Gate 1 的兩次 Jev 審查共 4,574 tokens（input 4,034、output 540）；Gate 2 的 Jev 審查為 2,739 tokens（input 2,469、output 270）；Gate 3 的 Jev 審查為 3,342 tokens（input 3,072、output 270）；Gate 3.1 的兩次 Jev 審查共 5,290 tokens（input 4,750、output 540）。這些數字**只包含 Jev**，不等於各 Gate 的完整開發用量。Codex 主代理與 Gate 3 Astra 子代理的逐 Gate 精確用量未提供，故記為「無法取得」，不填 0、不推算總數。Gate 1～3.1 細目見 `docs/reviews/GATE_1_REVIEW.json`、`docs/reviews/GATE_2_REVIEW.json`、`docs/reviews/GATE_3_REVIEW.json` 與 `docs/reviews/GATE_3_1_REVIEW.json`。

Gate 4 Token 用量：Jev 正式驗收一次，實測 input 2,318、output 270，合計 **2,588 tokens**，見 `docs/reviews/GATE_4_REVIEW.json`。Codex 主代理的逐 Gate input/output 精確用量無法取得；其他協作模型未使用，因此全 Gate 總計無法精確合計，不以 Jev 數字冒充總開發量。

### Gate 4 執行基線（Jev 已核准）

- 明確的 `start`、`end`、`boneCount` 輸入，產生 schema-valid `RigSpec` 直線等長骨鏈；根骨使用世界起點與朝向，子骨使用相對父骨的局部位移及零局部旋轉，parent-first 排序。Gate 4 不從圖片推測關節或自動綁定 Mesh，也不提前實作權重／動畫。
- 獨立正向運動學測試覆蓋水平、向上、斜向與反向，逐節核對 world joint 與終點；11 種退化輸入回傳 rig-stage 結構化錯誤。CLI 不覆寫輸入或既有輸出；固定輸入 100 次序列化完全一致。
- `npm run verify`：格式、lint、build/typecheck 與 69 tests／9 files 全過，包含先前 50 個測試。Jev `jev-1.13.0` 於 2026-09-24 核准，APPROVED probability 0.96、tests credible 0.86、evidence quality 3.95/4。下一 Gate 為 Gate 5 Weight Solver v1，依流程等待新的開發指令。

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

### Gate 3.2：以人工佈線為標準的靜態網格密度（Jev 重新核准）

**目前生效規則（使用者確認）**：使用原始 `.spine` 的同一 skin／slot／attachment 與同一 PNG 作為人工標準；頂點數雙向相對誤差 `abs(生成 − 人工) / 人工 ≤ 20%`。允許整數區間為 `ceil(人工 × 0.8)`～`floor(人工 × 1.2)`，多點或少點超標都不及格。此規則取代下述初次實作的一側 1.5 倍上限；2% 輪廓誤差門檻繼續有效。

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
- Gate 3.2 已達到進入 Gate 4 的條件；下一步依使用者指示先上傳此 Gate，再開始 Gate 4。

以下為首次開發計畫的歷史紀錄；其中一側 1.5 倍點數上限已失效，現行規則以上述 ±20% 為準。

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

Gate 0～3.2 已核准；Gate 3.2 歷經新人工點數門檻返工後重新獲 Jev 核准。下列內容是 Gate 0 的歷史範圍，不再限制後續已獲使用者授權的 Gate；使用者已授權開始 Gate 4：

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

Gate 0～17 每階段完成時，都要在最終回報與 Gate 紀錄附上該階段的 Token 用量。計算範圍從開始該 Gate 到 Jev 最終決定，包含返工與複審；不可只列最後一次呼叫。優先採用模型或工具提供的實際 input/output usage；若無逐 Gate 精確數據，明確寫「無法取得」，有可重現估算方法時才能另外標示「約」，不得把估算寫成實測。cached input 已包含在 input tokens、reasoning tokens 已包含在 output tokens，不重複加總；可見文字也不能反推完整 output 用量。見 [OpenAI 官方 Token 計數說明](https://developers.openai.com/api/docs/guides/token-counting)。
