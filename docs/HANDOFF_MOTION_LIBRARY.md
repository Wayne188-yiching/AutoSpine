# 交接：動作庫第 3 項（受擊、攻擊、跑）

記錄日期：2026-10-24。這份給公司電腦上的 Claude 接手用，做完就可以刪掉。

## 需求

在 `motion-draft`（CLI）與 `autospine_motion_draft`（MCP）加入三種動作，數值要像 ADR-032 一樣從人工動畫量出來，不能用猜的：

- **受擊（hit）**：單次動作。
- **攻擊（attack）**：單次動作。
- **跑（run）**：循環。

這是使用者在 2026-10-23 盤點動作庫時排定的三項中的最後一項：

1. 現有 10 種動作做成 `motion-draft`：已完成（ADR-048）。
2. 眨眼與揮手：已完成（ADR-049）。
3. 受擊、攻擊、跑：**還沒開始**。

## 為什麼要用工作室 NAS 的美術檔

ADR-032 的先驗值量自 2026-10 批次：68 段人工動畫、19 個檔案、15 套美術。它的類別只有 idle、動作循環、走路、道具／logo 循環、進場、退場、跳躍／勝利、蓄力／按壓、轉場和特效單次動作，**沒有受擊、攻擊和跑**。

所以第一步是在 NAS 上找出有這三種動畫的人工 Spine 檔（.spine 或 4.0 JSON 加圖），而且要盡量來自不同套美術。只有一兩套美術的類別，要像 walk、look 一樣標成弱先驗並寫明數量。

ADR-049 的眨眼與揮手是慣用值，因為那兩種在資料裡量不到。這三種不要照那樣做，除非 NAS 上真的找不到；如果找不到，先問使用者。

## 量測方式（照 ADR-032）

- 在官方 spine-core 4.0 runtime 上以 30 fps 播放人工檔來量，交付也必須是 30 fps。
- 先依動畫名稱和檔案類型把每段動畫分好類，**分好之後才讀數字**。
- 單位：
  - `hw` 是頭寬（方案臉部探針在 images-only setup 上的寬度）；
  - `N` 是動畫幀數的比例；
  - 旋轉取峰對峰值，依角色（四肢、長條、臉、道具、特效）取中位數。
- 同一套美術的換皮版本先平均，再取中位數。每項都記下中位數、範圍、動畫數與美術數。
- ADR-032 的量測腳本和流程在本機的 `docs/local-reviews/`（例如 `docs/local-reviews/blind-tests/2026-10-15-motion-priors/PROTOCOL.md`），**不在 git 裡**。寫這份交接的電腦上沒有，請在公司電腦找；找不到就照上面的規則重寫一支。

建議先量的項目（只是要量什麼，不是預設答案）：

- **受擊**：往哪個方向退、退多遠、多快回到原位；有沒有閃色（`colors`）或抖動；頭與長條晚幾幀。
- **攻擊**：預備、出手、收招各佔多少 `N`；出手那幾幀的位移與旋轉；四肢擺幅；key 間距與緩動。
- **跑**：一步幾幀、身體上下幅度、前傾角度、四肢與長條擺幅，和現有的 walk 先驗相比如何。

## 程式要改的地方（照 ADR-048／049 的做法）

- `packages/motion/src/priors.ts`：
  - `MOTION_PRIORS` 加入新類別；
  - `oneShotKind` 加入受擊、攻擊的名稱關鍵字（例如 Hit、Hurt、Damage、Attack、Atk，以實際檔名為準）；
  - `oneShotTemplate` 加入這兩種的模板；
  - `loopRecipe` 加入 `run`。
- `packages/character/src/draft.ts`：
  - `DRAFT_KINDS` 加入三種；
  - 不給 `--kind` 時，名稱也要能判斷出這三種。
- `packages/mcp/src/index.ts`：`autospine_motion_draft` 的工具說明。
- 測試：
  - `tests/motion-priors.test.ts`：中位數在範圍內、名稱選中模板；
  - `tests/motion-draft.test.ts`：草稿內容、能 build。
- 文件：
  - 新 ADR；
  - `docs/CHARACTER_PLAN.md` 的 motion drafts 段落；
  - `docs/USER_GUIDE.md` 的動作種類表；
  - `docs/MCP_ADAPTER.md`；
  - `plugin/skills/autospine/SKILL.md`；
  - `skills/autospine/references/engine-pipeline.md`。
- 版本號一次改 4 處：`.claude-plugin/marketplace.json`、`plugin/.claude-plugin/plugin.json`、`plugin/.codex-plugin/plugin.json`、`packages/cli/src/version.ts`。
- 然後跑 `npm run build:plugin`，再跑 `node tools/build-plugin.mjs --check`。
- 最後用 NAS 上**沒參與量測**的角色做盲測，build 並渲染出來看。

## 分支狀態（2026-10-24）

三條分支依序疊在 `origin/main`（`eed7ca3`）上，都已推送，還沒開 PR，也還沒合回 main：

| 分支                           | 頂端      | 內容                                         | 外掛   |
| ------------------------------ | --------- | -------------------------------------------- | ------ |
| `claude/adr045-collapse-qa`    | `8018eac` | 部件被壓成一條線的檢查（ADR-045）            | 0.5.11 |
| `claude/deliver-spine-version` | `e63eea4` | 交付到 Spine 4.1／4.2 與 3.8（ADR-046、047） | 0.5.13 |
| `claude/motion-draft`          | `153eb2b` | 動作草稿、眨眼與揮手（ADR-048、049）         | 0.5.15 |

建議從 `origin/claude/motion-draft` 開新分支來做；這樣下一份 ADR 是 ADR-050，外掛是 0.5.16。但開始前要先查 `origin/main` 和其他遠端分支有沒有已經用掉這兩個編號：`origin/claude/mummycat-weak-priors` 就也用了 ADR-045 這個編號，之前已經因為撞號重做過一次。

## 注意事項

- 只有使用者要求時才提交或推送。
- 遠端 main 的歷史改寫過。寫這份交接的電腦上，本機 `main` 還是改寫前的舊版，不能推送。公司電腦的本機 `main` 若和 `origin/main` 不一致，一律以 `origin/main` 為準。
- 在開啟 `core.autocrlf` 的 Windows 上：
  - `tests/plugin-package.test.ts` 會因為 `SKILL.md` 是 CRLF 換行而失敗；
  - `tests/key-reduction.test.ts` 在完整測試的高負載下可能超過 5 秒；
  - 兩個單獨跑都會過。
- `npm run format:check` 會掃到 `.claude/worktrees/`，以及本來就沒通過格式檢查的 `docs/reports/blind-tests/2026-10-19-jackpot-mummycat-clean-rebuild/`。檢查時把這兩處排除。
