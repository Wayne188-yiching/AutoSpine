# AutoSpine — Spine 應用知識基線

版本：0.1  
狀態：可供架構與 Gate 0 使用；Spine 4.3 格式細節仍須在 Gate 1 驗證  
最後整理：2026-09-22

## 1. 文件用途

本文件保存 AutoSpine 開發所需的 Spine 實務知識，讓不同電腦、不同 Codex 任務與不同模型能從同一基線繼續工作。

任何參與下列工作的 Agent，在修改程式前都必須先讀本文件：

- AssetSpec、RigSpec、MeshSpec、WeightSpec、ConstraintSpec、AnimationSpec
- Spine Adapter 與 Spine Compiler
- Mesh、Weight、Rig、Constraint、Animation Engine
- Preview、Visual Critic、MCP 與 AutoSpine Skill

本文件只保存經整理的技術知識，不保存或重新散布課程圖片、PSD、壓縮素材與影片內容。

## 2. 證據標記

每項規則使用以下標記：

| 標記                | 意義                                               |
| ------------------- | -------------------------------------------------- |
| `OFFICIAL_VERIFIED` | 已由 Spine 官方說明或 Runtime 行為支持             |
| `TUTORIAL_OBSERVED` | 可從現有課程畫面直接觀察                           |
| `ENGINE_POLICY`     | AutoSpine 為了可重現、自動化與安全而採用的工程規則 |
| `INFERRED`          | 由畫面或既有技術推定，尚未由完整操作或檔案驗證     |
| `SPINE_4_3_TODO`    | 進入 Gate 1 前必須用 Spine 4.3 真實輸出確認        |

若同一段同時包含多種證據，以較弱的標記為準。禁止把 `INFERRED` 改寫成已驗證事實。

## 3. 目前資料範圍與限制

目前已檢視 14 份課程畫面摘要，內容涵蓋：

- Spine 介面與基本操作
- Skeleton、Bone、Slot、Attachment
- 骨架建立與人物主體綁定
- 階層、IK／Transform／Path 類約束
- 上身、頭部與附屬物件綁定
- 受擊與跑步動畫
- Spine 特效
- Unity 對接
- 表情動畫

限制：

- 現有資料是多個影片時點組成的靜態畫面，不是完整影片或逐字稿。
- 畫面足以辨認工作類型，但不足以確認每個按鈕、參數值與操作順序。
- 課程使用的 Spine 版本尚未確認，不能直接當成 Spine 4.3 JSON 規格。
- 素材中的 PSD／壓縮檔僅作本機參考，不提交到 Repository。
- 素材附帶的聲明限制商業使用，因此 Repository 只保存原創技術摘要，不保存來源素材。

## 4. Spine 核心資料觀念

### 4.1 Skeleton、Bone、Slot、Attachment

`OFFICIAL_VERIFIED`

```text
Skeleton
└── Bone hierarchy
    └── Slot
        └── one visible Attachment
```

- Bone 提供 translation、rotation、scale、shear 等 transform。
- Attachment 不直接掛在 Bone，而是掛在 Slot；Slot 再掛在 Bone。
- Slot 決定 draw order，讓同一 Bone 上的圖可以位於其他 Bone 圖層的前面或後面。
- 一個 Slot 可以包含多個 Attachment，但同一時間只有一個 Attachment 可見。
- Attachment 可以是 region、mesh、path、bounding box、clipping 等類型。

AutoSpine 影響：

- `RigSpec` 管 Bone hierarchy。
- `AssetSpec` 保存來源部件與 draw order。
- `Spine Adapter` 建立 Slot 與 Attachment，不讓 Core 直接依賴 Spine JSON。
- Slot order 必須保持來源順序，除非 AnimationSpec 明確包含 draw-order timeline。

官方參考：<https://esotericsoftware.com/spine-basic-concepts>

### 4.2 Setup Pose 與 Animate Mode

`TUTORIAL_OBSERVED` + `ENGINE_POLICY`

- Setup Pose 是 Rig、Attachment、Mesh、Constraint 的基準狀態。
- Animate Mode 的 key 應描述相對於 setup 的動作，不應意外改壞 setup。
- 測試權重時應使用測試動畫或 Animate Mode，避免人工測試改動 setup。
- 自動產生 Rig 後，所有素材在 setup pose 的世界位置、角度與 draw order 必須與輸入一致。

AutoSpine 強制規則：

```text
Generated setup pose == source composition
```

若任何 region 的世界中心、角度或圖層關係意外改變，視為 build error，不是 warning。

### 4.3 Draw Order

`OFFICIAL_VERIFIED` + `TUTORIAL_OBSERVED`

- Draw order 由 Slot 清單順序決定，不等同 Bone hierarchy。
- 部件父子關係和畫面前後順序是兩個不同問題。
- 臉部、武器、前後手、衣物、特效尤其容易需要跨骨架層級安排 draw order。

Engine 規則：

- Asset Parser 必須保存來源 draw order。
- Rig 推定不得因重新 parenting 而改變 Slot order。
- Animation Engine 只有在明確的 `DrawOrderMotion` 中才能改變 draw order。

## 5. 素材拆分與輸入準備

### 5.1 可獨立運動的部件必須獨立

`TUTORIAL_OBSERVED`

課程畫面可見人物被拆為軀幹、頭部、臉部、四肢、武器、衣物、附屬物與特效等部件。表情案例則把眼睛、眼皮、眉毛、嘴型等分開。

拆分原則：

- 需要不同 transform 的內容分成不同 Attachment。
- 需要獨立換圖的表情或裝備放在可切換 Attachment 的 Slot。
- 需要連續變形的大片圖使用 Mesh + Weights。
- 背景、陰影和不需跟隨人物變形的效果留在 root 或專用 effect hierarchy。
- 關節處應保留足夠重疊像素，避免彎曲時露縫。

### 5.2 來源大小與實際顯示大小

`ENGINE_POLICY`

- PSD／manifest 記錄的顯示寬高與 PNG 像素尺寸不是同一概念。
- 為節省貼圖而縮小 PNG 時，不能把 skeleton display size 一起縮小。
- 所有 texture-space 到 world-space 的換算必須顯式使用 scale。
- X/Y scale 差異過大應報告為可能的 stale manifest 或錯誤圖片。

### 5.3 命名只提供提示

`ENGINE_POLICY`

- `head`、`arm_L`、`tail_03` 等語意名稱有助於分類，但不能取代幾何證據。
- 不明縮寫不得自行猜測，應標為 `unknown` 和 low confidence。
- 角色專屬命名規則放進 profile，不寫死在演算法。
- 最終 parent、joint 和 chain 判定應同時使用名稱、透明像素重疊、距離、方向與階層。

## 6. 骨架與階層

### 6.1 骨架應從驅動需求建立

`TUTORIAL_OBSERVED` + `ENGINE_POLICY`

- 骨骼沿需要旋轉或彎曲的結構放置，而不是每張圖固定一根骨。
- 軀幹使用 root／pelvis／spine／chest／neck／head 等主鏈表達重心傳遞。
- 四肢使用 shoulder／elbow／wrist 或 hip／knee／ankle 等關節鏈。
- 頭髮、尾巴、布料與觸鬚使用多段 chain 表達延遲與曲率。
- 武器、特效、表情控制和 IK target 使用獨立控制骨，避免污染 deform chain。

### 6.2 Joint 與 Pivot

`ENGINE_POLICY`

首選 pivot 是相鄰部件 alpha overlap 的中心，而不是圖片矩形中心：

```text
joint candidate = centroid(alpha(parent) ∩ alpha(child))
```

- overlap 代表美術實際畫出的接合區。
- 沒有 overlap 時可退回最近點或部件質心，但必須標為 low confidence。
- 肩、肘、膝、頸、尾根等 pivot 需要在 preview 中測試完整活動範圍。

### 6.3 Hierarchy 規則

`TUTORIAL_OBSERVED` + `ENGINE_POLICY`

- Parent 代表 transform 繼承，不代表 draw order。
- Control bone、deform bone、attachment bone 可以分工，避免所有責任塞進同一骨。
- Parent 必須先於 child 序列化。
- 不允許 cycle、missing parent 或零長度 deform chain。
- 背景、全局特效和陰影不得誤掛在局部變形骨下。

## 7. Mesh

### 7.1 何時使用 Mesh

`OFFICIAL_VERIFIED` + `TUTORIAL_OBSERVED`

適合使用 Mesh：

- 軀幹、臉、翅膀、尾巴、長髮、衣物等需要連續彎曲或體積變形的圖。
- 希望裁掉圖片大片透明區域以減少填色成本。
- 需要多根骨共同驅動同一 Attachment。

不需要使用 Mesh：

- 完全剛性的武器、小道具或不變形的裝飾。
- 只有四個角且不需要局部形變的圖；Region 更簡單且成本更低。

官方參考：<https://esotericsoftware.com/spine-meshes>

### 7.2 Topology 原則

`ENGINE_POLICY`

```text
Alpha mask
-> largest relevant component
-> contour
-> polygon simplification
-> joint-aware internal vertices
-> triangulation
-> validation
```

- 輪廓需要貼近有效不透明區域，但不要為每個像素建立 vertex。
- 關節附近提高密度，大片平坦區降低密度。
- Edge flow 應支援主要彎曲方向。
- Hull、triangle indices、UV 和 vertex order 必須符合輸出格式。
- Mesh 密度需兼顧變形平滑與人工可編輯性。

禁止：

- duplicate vertex
- zero-area／degenerate triangle
- invalid index
- 非預期 self-intersection
- disconnected deform region
- setup pose coverage 明顯不足

## 8. Weights

### 8.1 基本概念

`OFFICIAL_VERIFIED`

- 每個 vertex 對一或多根 Bone 有 influence。
- 所有 influence 需要正規化到總和 1。
- Bone transform 透過 weights 讓 Mesh 產生連續變形。
- Spine 的自動權重會考慮 Mesh topology，不只是歐氏距離。
- Smooth 依相鄰 vertex 平均權重；Prune 移除很小或過多的 influence。

官方參考：<https://esotericsoftware.com/spine-weights>

### 8.2 AutoSpine Weight Solver v1

`ENGINE_POLICY`

第一版允許較簡單但可驗證的做法：

```text
vertex
-> candidate bones
-> distance-to-segment influence
-> joint influence adjustment
-> top K (default 4)
-> normalize
-> topology-aware smoothing
-> prune
-> renormalize
```

必要 invariant：

- 所有 weight finite 且非負。
- 每個 vertex 至少一個 influence。
- 總和在容差內等於 1。
- influence bone 存在。
- influence 數量不超過設定值。
- 無有效候選時綁定最近 Bone，不留下 orphan vertex。

### 8.3 權重驗證方法

`OFFICIAL_VERIFIED` + `ENGINE_POLICY`

- 建立測試動畫讓每個關節通過預期最大活動範圍。
- Tail 測 root rotation、middle bend、wave。
- Arm 測 0°、30°、60°、90°、120°。
- 觀察 seam tearing、volume collapse、triangle inversion、過度拉伸與 endpoint distortion。
- 每次 smoothing 後再 prune，避免大量不可見的小 influence 增加 Runtime 成本。

## 9. Constraints

### 9.1 IK Constraint

`OFFICIAL_VERIFIED`

- IK 讓一或兩根 Bone 的末端指向或到達 target。
- 典型用途是手、腳、武器握點與地面接觸。
- Spine IK 支援一或兩根 constrained bones，不支援三根以上的鏈。
- IK target 不能是 constrained chain 的 descendant，否則形成 solver feedback。

`ENGINE_POLICY`

- 只有 setup pose 已提供可靠彎曲方向時才自動建立二骨 IK。
- 直線肢體沒有 bend-direction 證據時，跳過並報告，不猜膝蓋或手肘方向。
- 同一 Bone 不同時由多個 IK 驅動。

官方參考：<https://esotericsoftware.com/spine-ik-constraints>

### 9.2 Transform Constraint

`OFFICIAL_VERIFIED`

- Transform Constraint 可複製 target 的 rotation、translation、scale、shear 的全部或部分。
- Local/World 與 Relative/Absolute 會改變計算語意。
- Mix 可以被動畫化，用於控制影響強度。

`ENGINE_POLICY` + `SPINE_4_3_TODO`

- 可用於頭髮、布料、翅膀、尾巴的 follow-through。
- setup pose 中 constraint 不得讓 constrained bone 跳位或旋轉。
- `local + relative` 的 offset cancellation 必須用 Spine 4.3 Runtime 與真實輸出重新確認。
- 已由 IK 驅動的 chain 預設不再加 follow-through，避免 solver 互相競爭。

官方參考：<https://esotericsoftware.com/spine-transform-constraints>

### 9.3 Path Constraint

`OFFICIAL_VERIFIED` + `TUTORIAL_OBSERVED`

- Path Constraint 以 Slot 中目前可見的 Path Attachment 作為目標。
- 可控制 Bone 沿路徑的位置、間距、旋轉與平移 mix。
- 適合軌跡、繩索、觸鬚、長尾、隊列、平台移動和沿曲線排列的物件。
- Position、Spacing 和 Mix 都可以 key。

Engine-neutral `ConstraintSpec` 應表達意圖，不直接複製 Spine 欄位。

官方參考：<https://esotericsoftware.com/spine-path-constraints>

## 10. 動畫工作方法

### 10.1 Timing 與 Curve 分工

`OFFICIAL_VERIFIED` + `TUTORIAL_OBSERVED`

- Dopesheet 適合查看多個 property 的 key timing。
- Graph 適合調整單個 property 隨時間的 value 與 curve。
- Curve 必須是獨立資料結構，不能寫死在 breathe、wave 等 preset。
- 可用 fractional frame 表達非常短的狀態切換，但 Engine 內部仍應使用明確時間單位。

官方參考：

- <https://esotericsoftware.com/spine-dopesheet>
- <https://esotericsoftware.com/spine-graph>
- <https://esotericsoftware.com/spine-keys>

### 10.2 Loop

`ENGINE_POLICY`

- Spine Editor 的播放 Loop 範圍不等於動畫資料已保證無縫循環。
- AutoSpine 對 `loop: true` 的 animation 必須比較首尾：translation、rotation、scale、deform。
- 角度比較需要處理 360° wrap。
- 隨機眨眼等事件必須使用 seed，讓 build 可重現。

### 10.3 受擊動畫

`TUTORIAL_OBSERVED` + `INFERRED`

畫面呈現角色從原始姿勢進入明顯 recoil，再回復的多個 pose。可轉成以下 procedural 結構：

```text
anticipation（可選，短）
-> impact（位移／旋轉／壓縮最快）
-> overshoot
-> settle
```

實作規則：

- Impact 的時間短於 recovery。
- Root／chest 表達主要受力方向，附屬 chain 延後反應。
- 不要求所有 Bone 同時到達極值，避免機械感。
- 最終是否回 setup 由 AnimationSpec 決定。

具體 frame 數與 curve 尚未由完整影片驗證，不寫死為預設值。

### 10.4 跑步動畫

`TUTORIAL_OBSERVED` + `INFERRED`

課程畫面顯示循環中不同高度、四肢／武器位置與軀幹姿態。AutoSpine 應把跑步拆成：

- 身體上下位移與前後傾。
- 腿部 contact／passing／flight 類關鍵姿勢。
- 手臂或武器的反向擺動。
- 頭、背包、衣物與毛髮的延遲。
- 首尾 pose 與 velocity continuity。

這些是動畫結構，不代表課程中已確認特定 frame 配置。

### 10.5 Idle、呼吸與 Secondary Motion

`ENGINE_POLICY`

- 呼吸主要影響 pelvis／spine／chest 的小幅 translation、rotation 或 scale。
- 頭部與肩部影響較弱，避免整體同步縮放。
- 尾巴、頭髮、衣物 follow-through 應有 phase delay 與 amplitude decay。
- Secondary motion 應服從主動作，不和主動作搶視覺焦點。
- Loop 動畫的起訖狀態與斜率都應檢查。

### 10.6 表情與眨眼

`TUTORIAL_OBSERVED`

畫面顯示眼睛、眼皮、眉毛、嘴部等獨立控制或 Attachment。可採：

- Attachment switching：離散嘴型、眼型、特殊表情。
- Bone transform：眉毛、眼球、嘴角等局部移動。
- Mesh deform：需要平滑形變的眼皮或臉部。
- Color／alpha：淡入、發光或臉色變化。

Blink 規則：

- Close 通常快於 hold 與 reopen。
- 左右眼預設同步，但允許角色化 offset。
- 隨機眨眼使用明確 seed 和 min/max interval。
- 眼皮閉合後不得露出不應可見的眼白或瞳孔。

### 10.7 特效

`TUTORIAL_OBSERVED` + `INFERRED`

畫面顯示多層 glow、projectile、ring、trail 類圖片在 Spine 中組合。適合的基礎通道：

- translation、rotation、scale
- alpha／color
- attachment switching
- draw order
- additive 或其他 blend mode（需要 Spine 4.3 與 Runtime 驗證）

特效應使用獨立 effect hierarchy，避免受角色局部 deform chain 意外影響。AutoSpine MVP 不以複製完整粒子系統為目標。

## 11. Unity 對接

`TUTORIAL_OBSERVED` + `OFFICIAL_VERIFIED`

課程畫面顯示 Spine 內容進入 Unity 場景並以 Spine Runtime 元件播放。正式 pipeline 至少包含：

```text
Spine project
-> skeleton data export (JSON or binary)
-> texture atlas + images
-> matching spine-unity runtime
-> Unity asset import
-> SkeletonAnimation / appropriate component
-> material and render validation
```

必要規則：

- Editor export 版本與 spine-unity Runtime 版本必須相容。
- JSON／binary、atlas、texture 缺一不可。
- 驗證 shader、blend mode、mask、sorting、scale 與 texture settings。
- AutoSpine MVP 的正式輸出目標仍是可編輯 Spine 資料；Unity Adapter 不早於 Spine Adapter 穩定之後。

官方參考：

- <https://esotericsoftware.com/spine-unity>
- <https://esotericsoftware.com/spine-unity-assets>

## 12. AI 與 Deterministic Engine 邊界

### AI 可以決定

- 部件角色與命名建議
- Rig template
- Bone count 建議
- 動畫 preset 與參數範圍
- 低信心區域與 review priority
- 錯誤分類與修正方向

### Deterministic Engine 必須決定

- alpha mask、contour、polygon simplification
- triangulation 與 index
- bone transform math
- weight 計算、normalize、smooth、prune
- constraint 數值與求解順序
- timeline 數值插值
- schema validation 與 serialization
- Spine Adapter output

### 人工仍需判斷

- 關節體積是否符合角色美術風格
- Follow-through 強弱
- 表演節奏與情緒
- 遮擋／露縫的美術修補
- 高低信心推定是否合理
- 最後 20% 的 Weight、Mesh、Curve、Timing polish

## 13. 自動 Rig 驗收清單

### 結構

- Bone parent-first、無 cycle、名稱唯一。
- Slot target Bone 存在，draw order 與來源一致。
- Attachment 圖片存在，沒有 placeholder。
- 背景、陰影、effect 不在錯誤 deform hierarchy。
- Constraint target 合法且 order 唯一。

### Setup Pose

- 所有素材世界位置與來源一致。
- 世界旋轉、scale 與 draw order 沒有意外變動。
- IK／Transform／Path Constraint 在 setup 不造成跳位。

### Mesh／Weight

- Triangle index、UV、Hull 合法。
- 無 degenerate triangle。
- 所有 weights finite、非負、總和為 1。
- Joint 測試無明顯 tearing、collapse、inversion。
- Influence 數量符合設定並已 prune 無效小權重。

### 動畫

- Timeline target 存在。
- Curve type 合法。
- Loop Error Score 在 Gate 定義門檻內。
- Seeded motion 可重現。
- `__rig_check` 或等價 review animation 覆蓋所有推定關節與 IK target。

### 報告

- low confidence 全部列出。
- skipped constraints 全部列出原因。
- Geometry metrics 與 baseline 比較。
- Spine CLI 是否實際驗證清楚標示。
- Starter rig 不宣稱 production-ready。

## 14. 課程畫面索引與可用結論

| 畫面                                   | 可直接觀察                             | 不可由畫面單獨確認                |
| -------------------------------------- | -------------------------------------- | --------------------------------- |
| 第 01 課 基本介紹                      | Spine Editor、Tree、Timeline、角色案例 | 精確版本與完整工作流              |
| 第 02 課 基本操作                      | 素材導入、場景擺放、Tree／Properties   | 所有匯入設定值                    |
| 第 03 課 Skeleton/Bone/Slot/Attachment | 多 Attachment、骨架與 Tree 結構        | JSON 欄位與序列化規則             |
| 05 骨骼綁定工具                        | 軀幹骨骼建立與 pivot 操作              | 完整權重算法                      |
| 07 人物主體綁定                        | 軀幹、頭、臉、四肢與 Mesh 操作         | 每個 joint 的最終 hierarchy       |
| 09 Tree hierarchy 與 Constraints       | Hierarchy、控制物件與約束案例          | Constraint 類型的每個參數         |
| 13 Path／Link Constraints              | 沿 path 控制骨或物件                   | 課程所用版本的序列化格式          |
| 16 立繪上身綁定                        | 上身 hierarchy、timeline、curve 調整   | 全部 key timing                   |
| 18／19 頭部與附屬物                    | 臉部、眼睛、毛髮／裝飾分離控制         | 完整 facial rig 規格              |
| 28 受擊動畫                            | Recoil、極端 pose 與回復過程           | 精確 anticipation／recovery frame |
| 31 熊貓跑步                            | 循環 pose、身體高度、武器與附屬運動    | 精確 run cycle timing             |
| 44 Spine 特效                          | Glow、projectile、trail 的多層組合     | Blend mode 與 Runtime 差異        |
| 47 Spine 與 Unity                      | Unity 匯入與 Runtime 元件              | Runtime 版本與 export 設定        |
| 50 表情動畫                            | 眼、眼皮、眉、嘴等獨立控制             | 表情系統完整狀態機                |

## 15. 對 AutoSpine Gate 的直接影響

| 知識                                       | Gate       |
| ------------------------------------------ | ---------- |
| Bone／Slot／Attachment／draw order         | 0、1       |
| 素材拆分、顯示尺寸、PSD／PNG hierarchy     | 2          |
| Mesh topology 與 joint density             | 3、6、7    |
| Pivot、parent、chain                       | 4、12      |
| Weights、smooth、prune、joint deformation  | 5、6、7    |
| Procedural timing、secondary motion、blink | 8          |
| Graph／Curve                               | 9          |
| Loop continuity                            | 10         |
| Rig-check 與視覺檢查                       | 11、15     |
| IK／Transform／Path Constraint             | 13         |
| AI／Engine 邊界                            | 14、16、17 |

## 16. Gate 1 前必須完成的 Spine 4.3 驗證

`SPINE_4_3_TODO`

1. 使用合法的 Spine 4.3 Editor 建立最小專案。
2. 建立 root、child bone、slot、region、skin、簡單 animation。
3. 匯出 JSON 與 atlas，保存為 Gate 1 golden fixture。
4. 確認版本欄位、transform default、slot order、skin 與 attachment shape。
5. 用官方 Spine 4.3 Runtime 載入輸出。
6. 使用 Spine CLI 做 import／info round trip。
7. 記錄官方格式與課程舊版畫面的差異。
8. 由 Jev 驗收證據後，才開始正式 Compiler implementation。

## 17. 尚未完成的知識

以下不能因看過靜態畫面而宣稱完成：

- Spine 4.3 精確 JSON schema
- Spine 4.3 weighted mesh vertex encoding
- Transform Constraint 在 4.3 的全部數學與 update order
- Path Constraint 全部 rotate／spacing mode 的 Runtime 行為
- Clipping、Skin constraints、Physics constraints
- 完整 facial rig 與 lip-sync
- Unity 各版本 Runtime migration
- 課程中所有實際數值、快捷鍵與操作順序

這些項目必須透過官方文件、Runtime source、真實 export、測試 Fixture 或完整合法教學來源逐一補證。

## 18. 維護規則

- 新知識優先更新本文件，不另外建立重複的 Spine 概念文件。
- 演算法研究可以放在 `docs/research/`，但必須在本文件留下摘要與連結。
- 修改 `OFFICIAL_VERIFIED` 規則時，附官方來源。
- 修改 Mesh、Weight、Constraint 規則時，同時更新測試與 baseline。
- 舊版本行為不得直接套用到 Spine 4.3；版本差異需明確標示。
- 每個 Jev 批准的 Gate 可以把新的 Verified 結論回寫本文件。

## 19. Jev 驗收紀錄

驗收日期：2026-09-23  
模型：`jev-1.13.0`  
決定：`APPROVED`

| 檢查                 |     結果 |
| -------------------- | -------: |
| APPROVED probability |     1.00 |
| Scope compliant      |     0.96 |
| Evidence separated   |     0.97 |
| Claims supported     |     0.89 |
| Future portability   |     0.92 |
| Risks disclosed      |     0.95 |
| Evidence quality     | 3.85 / 4 |
| Primary blocker      |     NONE |

Jev 使用量：8,807 input tokens、248 output tokens。所有集中式開發流程所定義的強制門檻均通過。
