# 接手說明：Zeus MOV reference reconstruction

AutoSpine 依方案 `Zeus_all` 自動產生。在 Spine 4.0.64 用 Import Data 匯入 `Zeus_all.json`（圖片在 `images/`）。之後可以直接在 Spine 裡修改；手動修改不會回寫方案，要重新產生請改方案後再建置到新資料夾。

## 骨架

共 36 根骨。每根骨從自己的關節指向下一個關節，骨的顏色代表用途：

| 類型 | 用途 | 骨 |
| --- | --- | --- |
| 主骨（藍） | 動作的主控：呼吸、下沉的位移都打在這裡 | `body` |
| 骨鏈（綠） | 頭髮、尾巴、耳朵、鬍子、吊飾等軟部件的骨鏈，擺動打在這些骨的旋轉上 | `l_hair_1` `l_hair_2` `l_hair_3` `l_hair_01_1` `l_hair_01_2` `l_hair_01_3` `l_beard_1` `l_beard_2` `l_beard_3` `r_hair_1` `r_hair_2` `r_hair_3` `r_hair_01_1` `r_hair_01_2` `r_hair_01_3` `r_beard_1` `r_beard_2` `r_beard_3` `beard_1` `beard_2` `beard_3` `beard_tip_1` `beard_tip_2` `beard_tip_3` |
| 關節骨（預設色） | 身體關節：軀幹、頸、頭、四肢、手指 | `root` `base` `spine` `head` `arm_L` `forearm_L` `hand_L` `arm_R` `forearm_R` `hand_R` `lightning` |

中線：root → base → body → spine → head。

## 約束

- 無。

## 網格與權重

- `Body`：骨鏈（body、spine）
- `Clothing`：骨鏈（body、spine）
- `L_Arm_01`：骨鏈（arm_L、forearm_L）
- `L_Arm_02`：骨鏈（forearm_L、hand_L）
- `L_Hair`：骨鏈（L_Hair 的骨鏈）
- `L_Hair_01`：骨鏈（L_Hair_01 的骨鏈）
- `L_Beard`：骨鏈（L_Beard 的骨鏈）
- `R_Arm_01`：骨鏈（arm_R、forearm_R）
- `R_Arm_02`：骨鏈（forearm_R、hand_R）
- `R_Hair`：骨鏈（R_Hair 的骨鏈）
- `R_Hair_01`：骨鏈（R_Hair_01 的骨鏈）
- `R_Beard`：骨鏈（R_Beard 的骨鏈）
- `Beard`：骨鏈（Beard 的骨鏈）
- `Beard_02_1`：骨鏈（Beard_02_1 的骨鏈）
- 其他 68 個部件：依人工密度建網格，整片跟著所在的骨。

## 動畫

### Idle_02（60 幀）

- 起始姿勢：setup 姿勢沒動，這段動畫的姿勢是 `body`、`spine`、`head`、`arm_L`、`forearm_L`、`hand_L`、`arm_R`、`forearm_R`、`hand_R`、`lightning` 在每個關鍵幀上的固定偏移。改姿勢就改這些骨的關鍵幀（第 0 幀與最後一幀同值）。
- 關鍵姿勢：依參考圖在第 0、13、19、24、37、50 幀擺的姿勢（`body`、`spine`、`head`、`forearm_L`、`hand_L`、`arm_R`、`forearm_R`、`hand_R`、`lightning`），疊在主動作、跟隨和波動之上。改姿勢就改這些幀上的關鍵幀；兩者都動的骨在那段是逐幀的鍵。
- 部件組：顯示 38 個 slot，用 attachment 關鍵幀切換。
- 主動作：`body` 的 translate，對稱呼吸；幅度改第 30 幀的值。
- 共 10 根骨有關鍵幀，都是稀疏關鍵幀加貝茲曲線，可以直接拖動。

### Touch01（60 幀，單次）

- 單次動畫：不循環，最後一幀不必等於第 0 幀；換圖和顏色停在最後的值，主動作在最後一幀回到原位。
- 起始姿勢：setup 姿勢沒動，這段動畫的姿勢是 `body`、`spine`、`head`、`arm_L`、`forearm_L`、`hand_L`、`arm_R`、`forearm_R`、`hand_R`、`lightning` 在每個關鍵幀上的固定偏移。改姿勢就改這些骨的關鍵幀（第 0 幀與最後一幀同值）。
- 關鍵姿勢：依參考圖在第 0、10、20、22、25、27、39、48、60 幀擺的姿勢（`body`、`spine`、`head`、`forearm_L`、`hand_L`、`arm_R`、`forearm_R`、`hand_R`），疊在主動作、跟隨和波動之上。改姿勢就改這些幀上的關鍵幀；兩者都動的骨在那段是逐幀的鍵。
- 部件組：顯示 38 個 slot，用 attachment 關鍵幀切換。
- 主動作：`body` 的 translate，對稱呼吸；幅度改第 30 幀的值。
- 共 10 根骨有關鍵幀，都是稀疏關鍵幀加貝茲曲線，可以直接拖動。

### ToBonusGame（40 幀，單次）

- 單次動畫：不循環，最後一幀不必等於第 0 幀；換圖和顏色停在最後的值，主動作在最後一幀回到原位。
- 起始姿勢：setup 姿勢沒動，這段動畫的姿勢是 `body`、`spine`、`head`、`arm_L`、`forearm_L`、`hand_L`、`arm_R`、`forearm_R`、`hand_R`、`lightning` 在每個關鍵幀上的固定偏移。改姿勢就改這些骨的關鍵幀（第 0 幀與最後一幀同值）。
- 關鍵姿勢：依參考圖在第 0、2、4、6、8、10、12、40 幀擺的姿勢（`spine`、`head`、`forearm_L`、`hand_L`、`arm_R`、`forearm_R`、`hand_R`），疊在主動作、跟隨和波動之上。改姿勢就改這些幀上的關鍵幀；兩者都動的骨在那段是逐幀的鍵。
- 部件組：顯示 38 個 slot，用 attachment 關鍵幀切換。
- 主動作：`body` 的 translate，對稱呼吸；幅度改第 20 幀的值。
- 共 10 根骨有關鍵幀，都是稀疏關鍵幀加貝茲曲線，可以直接拖動。

## 常見調整

- 整體幅度：改 `body` 的關鍵幀。
- 頭的點頭：改 `head` 的 rotate 關鍵幀。
- 頭髮、尾巴的擺動：改骨鏈的 rotate 關鍵幀。
- 網格與權重：Spine 的 Weights 面板可以直接重刷；新增骨就照關節命名接到對應的父骨。

