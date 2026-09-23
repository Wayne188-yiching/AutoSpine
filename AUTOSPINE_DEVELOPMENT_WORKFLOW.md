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

| Gate | 交付目標                                            | 主要驗證                                                    | Jev 批准條件                                                                                                    | 建議模型               |
| ---- | --------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 0    | Repository、工具鏈、架構、IR 初版、ADR、Gate 1 計畫 | 安裝、build、lint、test、Schema type check                  | 基礎結構可重現；文件一致；沒有 Gate 1 功能偷跑                                                                  | GPT-5.6 Sol High       |
| 1    | AutoSpine IR 到最小 Spine 4.0.64 JSON               | Golden test；同 IR 重跑 100 次                              | 最小 skeleton/bone/slot/skin/region/animation 可編譯；輸出一致；格式有可靠來源                                  | GPT-5.6 Sol High       |
| 2    | PNG Parts，再擴充 PSD 到 AssetSpec                  | Parser unit/integration tests；bounds 與 hierarchy fixtures | 解析結果可序列化、可驗證、順序穩定；不包含 AI Rigging                                                           | GPT-5.6 Sol High       |
| 3    | Tail alpha 到可變形 MeshSpec                        | Contour、simplification、triangulation 測試；Mesh Validator | 無非法 index、零面積三角形、自交或非預期斷裂；固定輸入固定輸出                                                  | Astra 設計，Sol 實作   |
| 4    | Deterministic ChainRigTemplate                      | 骨長、位置、旋轉、parent 單元測試                           | start/end/boneCount 產出正確 chain；退化輸入有明確錯誤                                                          | GPT-5.6 Sol High       |
| 5    | Weight Solver v1                                    | Sum、NaN、negative、top-K、orphan、smoothing tests          | 每 vertex 有合法 influence；和為 1；最大 4；沒有假 Solver                                                       | Astra XHigh            |
| 6    | Tail deformation 與量化評估                         | Root/middle/wave poses；inversion、stretch、tearing metrics | 指標門檻明確且通過；保存 baseline；具可檢視輸出                                                                 | Astra High/XHigh       |
| 7    | Arm fixture 與 elbow deformation                    | 0/30/60/90/120 度 regression                                | 無不可接受 collapse、inversion 或不連續；指標和視覺證據一致                                                     | Astra High/XHigh       |
| 8    | Procedural Animation presets                        | 每個 preset 的輸出與 seed tests                             | wave、sway、breathing、bounce、float、rotateLoop、blink、followThrough、overshoot、squashStretch 由數值引擎生成 | GPT-5.6 Sol High       |
| 9    | 獨立 Curve Engine                                   | Curve unit tests 與端點、單調性檢查                         | linear、stepped、bezier、ease、overshoot 不與 preset 耦合                                                       | GPT-5.6 Sol High       |
| 10   | Loop Validator                                      | 首尾 translation/rotation/scale/deform 比較                 | Loop Error Score 可重現；錯誤能指出 target 與 stage                                                             | GPT-5.6 Sol High       |
| 11   | 最小 Preview                                        | 固定 frame 或 MP4 render integration test                   | Preview 能重現並對應同一 build manifest；不建立大型 GUI                                                         | GPT-5.6 Sol High       |
| 12   | Basic Humanoid Template                             | Hierarchy、對稱、fixture integration tests                  | 只含批准的基礎骨架；Tail 和 Arm regression 全過                                                                 | Sol 實作，Astra review |
| 13   | Engine-neutral Constraints                          | IK、transform、path-like behavior tests                     | Core API 不暴露 Spine-specific constraint 結構；求解穩定                                                        | Astra High             |
| 14   | AI Planner 到 Validated Spec                        | Structured output、schema rejection、fixture evals          | AI 只能產生通過 Schema 的 Spec；無效輸出不得觸發 Core                                                           | GPT-5.6 Sol High       |
| 15   | Visual Critic 到 CorrectionSpec                     | 已知缺陷集、precision/recall 類 eval、no-direct-edit test   | Critic 只提 CorrectionSpec；Core 決定重建；不直接改 geometry                                                    | Astra High             |
| 16   | MCP Adapter                                         | Tool contract、error mapping、integration tests             | 演算法留在 packages；MCP 只調用 Core API                                                                        | GPT-5.6 Sol High       |
| 17   | AutoSpine Skill                                     | Decision cases、tool policy、boundary review                | Skill 是知識與規則；Core 不依賴 Skill；無重複 Engine 邏輯                                                       | GPT-5.6 Sol High       |

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

| Gate | 狀態        | 開始       | Developer Verify | Jev Decision  | 備註                                                             |
| ---- | ----------- | ---------- | ---------------- | ------------- | ---------------------------------------------------------------- |
| 0    | APPROVED    | 2026-09-23 | 2026-09-23       | APPROVED 0.88 | Jev 1.13；Evidence 3.94/4                                        |
| 1    | APPROVED    | 2026-09-23 | 2026-09-23       | APPROVED 0.97 | Spine 4.0.64；18 tests、100 runs、Runtime/CLI 通過；Jev 複審核准 |
| 2    | NOT_STARTED | —          | —                | —             | 依賴 Gate 1                                                      |
| 3    | NOT_STARTED | —          | —                | —             | 依賴 Gate 2                                                      |
| 4    | NOT_STARTED | —          | —                | —             | 依賴 Gate 3                                                      |
| 5    | NOT_STARTED | —          | —                | —             | 依賴 Gate 4                                                      |
| 6    | NOT_STARTED | —          | —                | —             | Tail MVP 驗收點                                                  |
| 7    | NOT_STARTED | —          | —                | —             | Arm MVP 驗收點                                                   |
| 8    | NOT_STARTED | —          | —                | —             | 依賴 Joint baseline                                              |
| 9    | NOT_STARTED | —          | —                | —             | 依賴 Gate 8                                                      |
| 10   | NOT_STARTED | —          | —                | —             | 依賴 Gate 9                                                      |
| 11   | NOT_STARTED | —          | —                | —             | Engine MVP 驗收點                                                |
| 12   | NOT_STARTED | —          | —                | —             | Tail + Arm 通過後才開始                                          |
| 13   | NOT_STARTED | —          | —                | —             | 依賴 Gate 12                                                     |
| 14   | NOT_STARTED | —          | —                | —             | Core 成熟後才引入 AI                                             |
| 15   | NOT_STARTED | —          | —                | —             | 依賴 Preview 與 AI Planner                                       |
| 16   | NOT_STARTED | —          | —                | —             | MCP 僅作 Adapter                                                 |
| 17   | NOT_STARTED | —          | —                | —             | 最後建立 Skill                                                   |

Token 用量回補：Gate 0 的 Jev 驗收為 2,972 tokens（input 2,702、output 270）；Gate 1 的兩次 Jev 審查共 4,574 tokens（input 4,034、output 540）。這些數字**只包含 Jev**，不等於各 Gate 的完整開發用量。當時 Codex 的逐 Gate 精確用量未提供，故記為「無法取得」，不填 0、不推算總數。Gate 1 細目見 `docs/reviews/GATE_1_REVIEW.json`。

## 13. Gate 0 歷史範圍與下階段規則

Gate 0 與 Gate 1 均已完成並獲 Jev 核准。下列內容是 Gate 0 的歷史範圍，不再限制後續已獲使用者授權的 Gate；下一 Gate 仍須由使用者啟動：

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
