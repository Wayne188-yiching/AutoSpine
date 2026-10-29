# 接手說明：Jackpot 木乃伊貓 · 動作邏輯重建 31

AutoSpine 依方案 `JackpotMummyCat` 自動產生。在 Spine 4.0.64 用 Import Data 匯入 `JackpotMummyCat.json`（圖片在 `images/`）。之後可以直接在 Spine 裡修改；手動修改不會回寫方案，要重新產生請改方案後再建置到新資料夾。

## 骨架

共 57 根骨。每根骨從自己的關節指向下一個關節，骨的顏色代表用途：

| 類型 | 用途 | 骨 |
| --- | --- | --- |
| 主骨（藍） | 動作的主控：呼吸、下沉的位移都打在這裡 | `hips` |
| 控制骨（紅） | 沒有圖片，只用來驅動：臉部視差（face_ctl 等）、IK 目標、壓縮腿部的站姿骨、單次動畫的整體位移與縮放 | `move` `head` `face_base` `face_ctl` `face_counter` `hand_goal_l` `hand_goal_r` |
| 跟隨骨（橘） | 臉部五官與 2.5D 圖層，透過 transform 約束跟著臉部控制骨；`*_frame` 是對齊方向的載體 | `eye_l_frame` `eye_l` `eye_r_frame` `eye_r` |
| 骨鏈（綠） | 頭髮、尾巴、耳朵、鬍子、吊飾等軟部件的骨鏈，擺動打在這些骨的旋轉上 | `finger_l_1_1` `finger_l_1_2` `finger_l_2_1` `finger_l_2_2` `finger_l_3_1` `finger_l_3_2` `finger_l_4_1` `finger_l_4_2` `finger_r_1_1` `finger_r_1_2` `finger_r_2_1` `finger_r_2_2` `finger_r_3_1` `finger_r_3_2` `finger_r_4_1` `finger_r_4_2` `tail_1` `tail_2` `tail_3` `tail_4` `ear_l_1` `ear_l_2` `ear_l_3` `ear_r_1` `ear_r_2` `ear_r_3` |
| 關節骨（預設色） | 身體關節：軀幹、頸、頭、四肢、手指；有關鍵幀的上層骨帶著單次動畫的整體位移與縮放 | `root` `spine` `chest` `pupil_l` `lid_l` `pupil_r` `lid_r` `arm_l` `forearm_l` `hand_l` `arm_r` `forearm_r` `hand_r` `thigh_l` `calf_l` `foot_l` `thigh_r` `calf_r` `foot_r` |

中線：root → move → hips → spine → chest → head。

## 約束

- IK `plant_l`：`thigh_l`、`calf_l` 指向 `foot_l`（移動目標骨就能改手腳位置）。
- IK `reach_l`：`arm_l`、`forearm_l` 指向 `hand_goal_l`（移動目標骨就能改手腳位置）。
- IK `plant_r`：`thigh_r`、`calf_r` 指向 `foot_r`（移動目標骨就能改手腳位置）。
- IK `reach_r`：`arm_r`、`forearm_r` 指向 `hand_goal_r`（移動目標骨就能改手腳位置）。
- Transform `face_counter`：`face_counter` 跟著 `face_ctl`，位移比例 -0.3（local、relative）。調整五官跟隨的多寡改這個 mix。
- Transform `Face_eye_l`：`eye_l` 跟著 `face_ctl`，位移比例 0.697（local、relative）。調整五官跟隨的多寡改這個 mix。
- Transform `Face_eye_r`：`eye_r` 跟著 `face_ctl`，位移比例 0.697（local、relative）。調整五官跟隨的多寡改這個 mix。

## 網格與權重

- `tou_1_2`：臉部圓頂（視差）
- `tou_1_1`：臉部圓頂（視差）
- `shenti_1`：兩骨漸層（hips → chest）
- `weiba_1`：骨鏈（tail_1、tail_2、tail_3、tail_4）
- `er_1`：骨鏈（ear_l_1、ear_l_2、ear_l_3）
- `er_2`：骨鏈（ear_r_1、ear_r_2、ear_r_3）
- `shoubi_l_1`：單骨（arm_l）
- `shoubi_l_2`：單骨（forearm_l）
- `jio_l_3`：骨鏈（thigh_l、calf_l）
- `jio_l_2`：兩骨漸層（calf_l → foot_l）
- `shouzhi_l_1`：骨鏈（finger_l_1_1、finger_l_1_2）
- `shouzhi_l_2`：骨鏈（finger_l_2_1、finger_l_2_2）
- `shouzhi_l_3`：骨鏈（finger_l_3_1、finger_l_3_2）
- `shouzhi_l_4`：骨鏈（finger_l_4_1、finger_l_4_2）
- `shoubi_r_2`：單骨（arm_r）
- `shoubi_r_1`：單骨（forearm_r）
- `jio_r_2`：骨鏈（thigh_r、calf_r）
- `jio_r_3`：兩骨漸層（calf_r → foot_r）
- `shouzhi_r_1`：骨鏈（finger_r_1_1、finger_r_1_2）
- `shouzhi_r_2`：骨鏈（finger_r_2_1、finger_r_2_2）
- `shouzhi_r_3`：骨鏈（finger_r_3_1、finger_r_3_2）
- `shouzhi_r_4`：骨鏈（finger_r_4_1、finger_r_4_2）
- `mnm/er_1s#mnm/er_1ss`：轉移（光暈、陰影）
- `mnm/er_2s#mnm/er_2ss`：轉移（光暈、陰影）
- `mnm/jio_l_2s#mnm/jio_l2_2`：轉移（光暈、陰影）
- `mnm/jio_l_2s#mnm/jio_l_2ss`：轉移（光暈、陰影）
- `mnm/jio_l_3s#mnm/jio_l2_3`：轉移（光暈、陰影）
- `mnm/jio_l_3s#mnm/jio_l_3ss`：轉移（光暈、陰影）
- `mnm/jio_r_2s#mnm/jio_r_2ss`：轉移（光暈、陰影）
- `mnm/jio_r_3s#mnm/jio_rl2_3`：轉移（光暈、陰影）
- `mnm/jio_r_3s#mnm/jio_r_3ss`：轉移（光暈、陰影）
- `mnm/shenti_1s#mnm/shenti_1ss`：轉移（光暈、陰影）
- `mnm/shoubi_l_1s#mnm/shoubi_l_1ss`：轉移（光暈、陰影）
- `mnm/shoubi_l_1s#mnm/shoubi_l_5`：轉移（光暈、陰影）
- `mnm/shoubi_r_2s#mnm/shoubi_l_5`：轉移（光暈、陰影）
- `mnm/shoubi_r_2s#mnm/shoubi_r_2ss`：轉移（光暈、陰影）
- `mnm/tou_1_2s#mnm/tou_1_2ss`：轉移（光暈、陰影）
- `mnm/weiba_1s#mnm/weiba_1ss`：轉移（光暈、陰影）
- `shoubi_l_2s#mnm/shoubi_l_2`：轉移（光暈、陰影）
- `shoubi_l_2s#mnm/shoubi_l_3`：轉移（光暈、陰影）
- `shoubi_l_2s#mnm/shoubi_l_4`：轉移（光暈、陰影）
- `shoubi_l_2s#mnm/shoubi_r_1ss`：轉移（光暈、陰影）
- `shoubi_r_1s#mnm/shoubi_l_3`：轉移（光暈、陰影）
- `shoubi_r_1s#mnm/shoubi_l_4`：轉移（光暈、陰影）
- `shoubi_r_1s#mnm/shoubi_r_1ss`：轉移（光暈、陰影）
- 其他 27 個部件：依人工密度建網格，整片跟著所在的骨。

## 動畫

### clap（60 幀）

- 部件組：顯示 47 個 slot，用 attachment 關鍵幀切換。
- 主動作：`hips` 的 translate，對稱呼吸；幅度改第 8 幀的值。
- 關鍵幀：`move` 的 scale。
- 關鍵幀：`move` 的 translate。
- 關鍵幀：`spine` 的 rotate。
- 關鍵幀：`chest` 的 rotate。
- 關鍵幀：`chest` 的 translate。
- 關鍵幀：`head` 的 translate。
- 關鍵幀：`head` 的 rotate。
- 關鍵幀：`head` 的 scale。
- 關鍵幀：`face_ctl` 的 translate。
- 關鍵幀：`hand_goal_l` 的 translate。
- 關鍵幀：`hand_l` 的 rotate。
- 關鍵幀：`pupil_l` 的 translate。
- 關鍵幀：`lid_l` 的 scale。
- 關鍵幀：`hand_goal_r` 的 translate。
- 關鍵幀：`hand_r` 的 rotate。
- 關鍵幀：`pupil_r` 的 translate。
- 關鍵幀：`lid_r` 的 scale。
- 關鍵幀：`tail_1` 的 rotate。
- 關鍵幀：`tail_2` 的 rotate。
- 關鍵幀：`tail_3` 的 rotate。
- 關鍵幀：`tail_4` 的 rotate。
- 關鍵幀：`ear_l_1` 的 translate。
- 關鍵幀：`ear_r_1` 的 translate。
- 關鍵幀：`finger_l_1_1` 的 rotate。
- 關鍵幀：`finger_l_2_1` 的 rotate。
- 關鍵幀：`finger_l_2_2` 的 rotate。
- 關鍵幀：`finger_l_3_1` 的 rotate。
- 關鍵幀：`finger_l_4_1` 的 rotate。
- 關鍵幀：`finger_r_1_1` 的 rotate。
- 關鍵幀：`finger_r_1_2` 的 rotate。
- 關鍵幀：`finger_r_2_1` 的 rotate。
- 關鍵幀：`finger_r_3_1` 的 rotate。
- 關鍵幀：`finger_r_4_1` 的 rotate。
- 共 30 根骨有關鍵幀，都是稀疏關鍵幀加貝茲曲線，可以直接拖動。

### idle（60 幀）

- 部件組：顯示 50 個 slot，用 attachment 關鍵幀切換。
- 主動作：`hips` 的 translate，對稱呼吸；幅度改第 15 幀的值。
- 關鍵幀：`move` 的 scale。
- 關鍵幀：`move` 的 translate。
- 關鍵幀：`spine` 的 rotate。
- 關鍵幀：`chest` 的 rotate。
- 關鍵幀：`chest` 的 translate。
- 關鍵幀：`head` 的 translate。
- 關鍵幀：`head` 的 rotate。
- 關鍵幀：`head` 的 scale。
- 關鍵幀：`face_ctl` 的 translate。
- 關鍵幀：`hand_goal_l` 的 translate。
- 關鍵幀：`hand_l` 的 rotate。
- 關鍵幀：`pupil_l` 的 translate。
- 關鍵幀：`lid_l` 的 scale。
- 關鍵幀：`hand_goal_r` 的 translate。
- 關鍵幀：`hand_r` 的 rotate。
- 關鍵幀：`pupil_r` 的 translate。
- 關鍵幀：`lid_r` 的 scale。
- 關鍵幀：`tail_1` 的 rotate。
- 關鍵幀：`tail_2` 的 rotate。
- 關鍵幀：`tail_3` 的 rotate。
- 關鍵幀：`tail_4` 的 rotate。
- 關鍵幀：`ear_l_1` 的 translate。
- 關鍵幀：`ear_r_1` 的 translate。
- 關鍵幀：`finger_l_1_1` 的 rotate。
- 關鍵幀：`finger_l_2_1` 的 rotate。
- 關鍵幀：`finger_l_2_2` 的 rotate。
- 關鍵幀：`finger_l_3_1` 的 rotate。
- 關鍵幀：`finger_l_4_1` 的 rotate。
- 關鍵幀：`finger_r_1_1` 的 rotate。
- 關鍵幀：`finger_r_1_2` 的 rotate。
- 關鍵幀：`finger_r_2_1` 的 rotate。
- 關鍵幀：`finger_r_3_1` 的 rotate。
- 關鍵幀：`finger_r_4_1` 的 rotate。
- 共 30 根骨有關鍵幀，都是稀疏關鍵幀加貝茲曲線，可以直接拖動。

### idle2（120 幀）

- 部件組：顯示 50 個 slot，用 attachment 關鍵幀切換。
- 主動作：`hips` 的 translate，對稱呼吸；幅度改第 15 幀的值。
- 關鍵幀：`move` 的 scale。
- 關鍵幀：`move` 的 translate。
- 關鍵幀：`spine` 的 rotate。
- 關鍵幀：`chest` 的 rotate。
- 關鍵幀：`chest` 的 translate。
- 關鍵幀：`head` 的 translate。
- 關鍵幀：`head` 的 rotate。
- 關鍵幀：`head` 的 scale。
- 關鍵幀：`face_ctl` 的 translate。
- 關鍵幀：`hand_goal_l` 的 translate。
- 關鍵幀：`hand_l` 的 rotate。
- 關鍵幀：`pupil_l` 的 translate。
- 關鍵幀：`lid_l` 的 scale。
- 關鍵幀：`hand_goal_r` 的 translate。
- 關鍵幀：`hand_r` 的 rotate。
- 關鍵幀：`pupil_r` 的 translate。
- 關鍵幀：`lid_r` 的 scale。
- 關鍵幀：`tail_1` 的 rotate。
- 關鍵幀：`tail_2` 的 rotate。
- 關鍵幀：`tail_3` 的 rotate。
- 關鍵幀：`tail_4` 的 rotate。
- 關鍵幀：`ear_l_1` 的 translate。
- 關鍵幀：`ear_r_1` 的 translate。
- 關鍵幀：`finger_l_1_1` 的 rotate。
- 關鍵幀：`finger_l_2_1` 的 rotate。
- 關鍵幀：`finger_l_2_2` 的 rotate。
- 關鍵幀：`finger_l_3_1` 的 rotate。
- 關鍵幀：`finger_l_4_1` 的 rotate。
- 關鍵幀：`finger_r_1_1` 的 rotate。
- 關鍵幀：`finger_r_1_2` 的 rotate。
- 關鍵幀：`finger_r_2_1` 的 rotate。
- 關鍵幀：`finger_r_3_1` 的 rotate。
- 關鍵幀：`finger_r_4_1` 的 rotate。
- 共 30 根骨有關鍵幀，都是稀疏關鍵幀加貝茲曲線，可以直接拖動。

### idle_clap（4 幀，單次）

- 單次動畫：不循環，最後一幀不必等於第 0 幀；換圖和顏色停在最後的值，主動作在最後一幀回到原位。
- 部件組：顯示 50 個 slot，用 attachment 關鍵幀切換。
- 主動作：`hips` 的 translate，對稱呼吸；幅度改第 2 幀的值。
- 關鍵幀：`move` 的 scale。
- 關鍵幀：`move` 的 translate。
- 關鍵幀：`spine` 的 rotate。
- 關鍵幀：`chest` 的 rotate。
- 關鍵幀：`chest` 的 translate。
- 關鍵幀：`head` 的 translate。
- 關鍵幀：`head` 的 rotate。
- 關鍵幀：`head` 的 scale。
- 關鍵幀：`face_ctl` 的 translate。
- 關鍵幀：`hand_goal_l` 的 translate。
- 關鍵幀：`hand_l` 的 rotate。
- 關鍵幀：`pupil_l` 的 translate。
- 關鍵幀：`lid_l` 的 scale。
- 關鍵幀：`hand_goal_r` 的 translate。
- 關鍵幀：`hand_r` 的 rotate。
- 關鍵幀：`pupil_r` 的 translate。
- 關鍵幀：`lid_r` 的 scale。
- 關鍵幀：`tail_1` 的 rotate。
- 關鍵幀：`tail_2` 的 rotate。
- 關鍵幀：`tail_3` 的 rotate。
- 關鍵幀：`tail_4` 的 rotate。
- 關鍵幀：`ear_l_1` 的 translate。
- 關鍵幀：`ear_r_1` 的 translate。
- 關鍵幀：`finger_l_1_1` 的 rotate。
- 關鍵幀：`finger_l_2_1` 的 rotate。
- 關鍵幀：`finger_l_2_2` 的 rotate。
- 關鍵幀：`finger_l_3_1` 的 rotate。
- 關鍵幀：`finger_l_4_1` 的 rotate。
- 關鍵幀：`finger_r_1_1` 的 rotate。
- 關鍵幀：`finger_r_1_2` 的 rotate。
- 關鍵幀：`finger_r_2_1` 的 rotate。
- 關鍵幀：`finger_r_3_1` 的 rotate。
- 關鍵幀：`finger_r_4_1` 的 rotate。
- 換圖：`shoubi_l_2` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shoubi_r_1` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_l2_1` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_l2_2` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_l2_3` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_l2_6` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_l2_7` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_l2_8` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_l_1` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_l_2` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_l_3` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_l_4` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_l_5` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_l_5s` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_r_1` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_r_2` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_r_3` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_r_4` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_r_5` 在 0、4 幀切換附件（例如眨眼）。
- 換圖：`shouzhi_r_5s` 在 0、4 幀切換附件（例如眨眼）。
- 共 30 根骨有關鍵幀，都是稀疏關鍵幀加貝茲曲線，可以直接拖動。

### in（30 幀，單次）

- 單次動畫：不循環，最後一幀不必等於第 0 幀；換圖和顏色停在最後的值，主動作在最後一幀回到原位。
- 部件組：顯示 48 個 slot，用 attachment 關鍵幀切換。
- 主動作：`hips` 的 translate，對稱呼吸；幅度改第 15 幀的值。
- 關鍵幀：`move` 的 scale。
- 關鍵幀：`move` 的 translate。
- 關鍵幀：`spine` 的 rotate。
- 關鍵幀：`chest` 的 rotate。
- 關鍵幀：`chest` 的 translate。
- 關鍵幀：`head` 的 translate。
- 關鍵幀：`head` 的 rotate。
- 關鍵幀：`head` 的 scale。
- 關鍵幀：`face_ctl` 的 translate。
- 關鍵幀：`hand_goal_l` 的 translate。
- 關鍵幀：`hand_l` 的 rotate。
- 關鍵幀：`pupil_l` 的 translate。
- 關鍵幀：`lid_l` 的 scale。
- 關鍵幀：`hand_goal_r` 的 translate。
- 關鍵幀：`hand_r` 的 rotate。
- 關鍵幀：`pupil_r` 的 translate。
- 關鍵幀：`lid_r` 的 scale。
- 關鍵幀：`tail_1` 的 rotate。
- 關鍵幀：`tail_2` 的 rotate。
- 關鍵幀：`tail_3` 的 rotate。
- 關鍵幀：`tail_4` 的 rotate。
- 關鍵幀：`ear_l_1` 的 translate。
- 關鍵幀：`ear_r_1` 的 translate。
- 關鍵幀：`finger_l_1_1` 的 rotate。
- 關鍵幀：`finger_l_2_1` 的 rotate。
- 關鍵幀：`finger_l_2_2` 的 rotate。
- 關鍵幀：`finger_l_3_1` 的 rotate。
- 關鍵幀：`finger_l_4_1` 的 rotate。
- 關鍵幀：`finger_r_1_1` 的 rotate。
- 關鍵幀：`finger_r_1_2` 的 rotate。
- 關鍵幀：`finger_r_2_1` 的 rotate。
- 關鍵幀：`finger_r_3_1` 的 rotate。
- 關鍵幀：`finger_r_4_1` 的 rotate。
- 共 30 根骨有關鍵幀，都是稀疏關鍵幀加貝茲曲線，可以直接拖動。

## 常見調整

- 整體幅度：改 `hips` 的關鍵幀。
- 頭的點頭：改 `head` 的 rotate 關鍵幀。
- 臉部轉向感：改 `face_ctl` 的 translate；五官跟得多或少改對應 Transform 約束的 mix。
- 頭髮、尾巴的擺動：改骨鏈的 rotate 關鍵幀。
- 網格與權重：Spine 的 Weights 面板可以直接重刷；新增骨就照關節命名接到對應的父骨。

