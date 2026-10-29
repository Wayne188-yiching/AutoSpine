# 接手說明：TheCat MOV reference reconstruction

AutoSpine 依方案 `TheCat_all` 自動產生。在 Spine 4.0.64 用 Import Data 匯入 `TheCat_all.json`（圖片在 `images/`）。之後可以直接在 Spine 裡修改；手動修改不會回寫方案，要重新產生請改方案後再建置到新資料夾。

## 骨架

共 25 根骨。每根骨從自己的關節指向下一個關節，骨的顏色代表用途：

| 類型 | 用途 | 骨 |
| --- | --- | --- |
| 主骨（藍） | 動作的主控：呼吸、下沉的位移都打在這裡 | `body` |
| 控制骨（紅） | 沒有圖片，只用來驅動：臉部視差（face_ctl 等）、IK 目標、壓縮腿部的站姿骨、單次動畫的整體位移與縮放 | `tail_control` |
| 骨鏈（綠） | 頭髮、尾巴、耳朵、鬍子、吊飾等軟部件的骨鏈，擺動打在這些骨的旋轉上 | `whisker_L_1` `whisker_L_2` `whisker_L_3` `whisker_R_1` `whisker_R_2` `whisker_R_3` `tail_1` `tail_2` `tail_3` |
| 關節骨（預設色） | 身體關節：軀幹、頸、頭、四肢、手指；有關鍵幀的上層骨帶著單次動畫的整體位移與縮放 | `root` `base` `spine` `head` `arm_L` `forearm_L` `paw_L` `ear_L` `eye_L` `arm_R` `forearm_R` `paw_R` `ear_R` `eye_R` |

中線：root → base → body → spine → head。

- 骨鏈 `Beard_L`：根部朝向指定附著點，末端向外；仍需在 Spine 檢視彎曲。
- 骨鏈 `Beard_R`：根部朝向指定附著點，末端向外；仍需在 Spine 檢視彎曲。
- 骨鏈 `Tail_M`：根部朝向指定附著點，末端向外；仍需在 Spine 檢視彎曲。

## 約束

- 無。

## 網格與權重

- `Body_10`：骨鏈（spine、head）
- `Body_01`：骨鏈（body、spine）
- `Hand_L_01`：骨鏈（arm_L、forearm_L）
- `Beard_L`：骨鏈（Beard_L 的骨鏈）
- `Hand_R_01`：骨鏈（arm_R、forearm_R）
- `Beard_R`：骨鏈（Beard_R 的骨鏈）
- `Tail_M`：骨鏈（Tail_M 的骨鏈）
- `Tail_R_01`：骨鏈（tail_1、tail_2、tail_3）
- `Tail_R_02`：骨鏈（tail_1、tail_2、tail_3）
- `Tail_R_03`：骨鏈（tail_1、tail_2、tail_3）
- `Tail_R_04`：骨鏈（tail_1、tail_2、tail_3）
- `Tail_R_05`：骨鏈（tail_1、tail_2、tail_3）
- `Tail_R_06`：骨鏈（tail_1、tail_2、tail_3）
- `Tail_L_01`：骨鏈（tail_1、tail_2、tail_3）
- `Tail_L_02`：骨鏈（tail_1、tail_2、tail_3）
- `Tail_L_03`：骨鏈（tail_1、tail_2、tail_3）
- `Tail_L_04`：骨鏈（tail_1、tail_2、tail_3）
- `Tail_L_05`：骨鏈（tail_1、tail_2、tail_3）
- `Tail_L_06`：骨鏈（tail_1、tail_2、tail_3）
- 其他 32 個部件：依人工密度建網格，整片跟著所在的骨。

## 動畫

### Idel_02（120 幀）

- 起始姿勢：setup 姿勢沒動，這段動畫的姿勢是 `tail_control`、`body`、`spine`、`head`、`arm_L`、`forearm_L`、`ear_L`、`eye_L`、`arm_R`、`forearm_R`、`ear_R`、`eye_R` 在每個關鍵幀上的固定偏移。改姿勢就改這些骨的關鍵幀（第 0 幀與最後一幀同值）。
- 關鍵姿勢：依參考圖在第 0、19、26、39、50、58、76、80、83、94、100、106 幀擺的姿勢（`body`、`spine`、`head`、`arm_L`、`forearm_L`、`ear_L`、`arm_R`、`forearm_R`、`ear_R`、`tail_control`），疊在主動作、跟隨和波動之上。改姿勢就改這些幀上的關鍵幀；兩者都動的骨在那段是逐幀的鍵。
- 時間錯開：`ear_L` 比 `head` 早 7 幀、`tail_control` 比 `body` 晚 1 幀，跟參考影片一樣。這些骨的關鍵姿勢整段錯開了這麼多幀（循環動畫繞回開頭），所以它們的關鍵幀不和上面的骨對齊；要對齊就把那根骨的關鍵幀拖回去。
- 部件組：顯示 47 個 slot，用 attachment 關鍵幀切換。
- 主動作：`body` 的 translate，對稱呼吸；幅度改第 60 幀的值。
- 關鍵幀：`tail_control` 的 scale。
- 關鍵幀：`ear_L` 的 rotate。
- 關鍵幀：`ear_R` 的 rotate。
- 換圖：`CloseEye_L` 在 0、42、96 幀切換附件（例如眨眼）。
- 換圖：`CloseEye_R` 在 0、42、96 幀切換附件（例如眨眼）。
- 換圖：`Eye_L_01` 在 0、42、96 幀切換附件（例如眨眼）。
- 換圖：`Eye_L_02` 在 0、42、96 幀切換附件（例如眨眼）。
- 換圖：`Eye_L_03` 在 0、42、96 幀切換附件（例如眨眼）。
- 換圖：`Eye_L_04` 在 0、42、96 幀切換附件（例如眨眼）。
- 換圖：`Eye_R_01` 在 0、42、96 幀切換附件（例如眨眼）。
- 換圖：`Eye_R_02` 在 0、42、96 幀切換附件（例如眨眼）。
- 換圖：`Eye_R_03` 在 0、42、96 幀切換附件（例如眨眼）。
- 換圖：`Eye_R_04` 在 0、42、96 幀切換附件（例如眨眼）。
- 換圖：`Mouth_02` 在 0、42、94 幀切換附件（例如眨眼）。
- 換圖：`Tongue` 在 0、47、89 幀切換附件（例如眨眼）。
- 換圖：`Mouth_03` 在 0、42、94 幀切換附件（例如眨眼）。
- 網格變形 `video_Mouth_02`：`Mouth_02` 在 0、42、60、72、90、120 幀變形（控制點 tl、tr、bl、br）；在 Spine 選該附件的 Deform 關鍵幀修改。
- 網格變形 `video_Tongue`：`Tongue` 在 0、120 幀變形（控制點 tl、tr、bl、br）；在 Spine 選該附件的 Deform 關鍵幀修改。
- 網格變形 `video_Jaw`：`Jaw` 在 0、35、60、75、96、120 幀變形（控制點 tl、tr、bl、br）；在 Spine 選該附件的 Deform 關鍵幀修改。
- 網格變形 `video_Mouth_03`：`Mouth_03` 在 0、35、60、75、96、120 幀變形（控制點 tl、tr、bl、br）；在 Spine 選該附件的 Deform 關鍵幀修改。
- 網格變形 `video_face_yawn`：`Face` 在 0、35、60、75、96、120 幀變形（控制點 tl、tr、ml、mr、chin）；在 Spine 選該附件的 Deform 關鍵幀修改。
- 共 12 根骨有關鍵幀，都是稀疏關鍵幀加貝茲曲線，可以直接拖動。

## 常見調整

- 整體幅度：改 `body` 的關鍵幀。
- 頭的點頭：改 `head` 的 rotate 關鍵幀。
- 頭髮、尾巴的擺動：改骨鏈的 rotate 關鍵幀。
- 網格與權重：Spine 的 Weights 面板可以直接重刷；新增骨就照關節命名接到對應的父骨。

