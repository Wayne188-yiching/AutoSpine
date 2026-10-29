# 接手說明：PolarRoar MOV reference reconstruction

AutoSpine 依方案 `PolarRoar_all` 自動產生。在 Spine 4.0.64 用 Import Data 匯入 `PolarRoar_all.json`（圖片在 `images/`）。之後可以直接在 Spine 裡修改；手動修改不會回寫方案，要重新產生請改方案後再建置到新資料夾。

## 骨架

共 97 根骨。每根骨從自己的關節指向下一個關節，骨的顏色代表用途：

| 類型 | 用途 | 骨 |
| --- | --- | --- |
| 主骨（藍） | 動作的主控：呼吸、下沉的位移都打在這裡 | `body` |
| 關節骨（預設色） | 身體關節：軀幹、頸、頭、四肢、手指 | `root` `base` `ice_89` `ice_88` `ice_87` `ice_86` `ice_85` `ice_84` `ice_83` `ice_82` `ice_81` `ice_80` `ice_79` `ice_78` `ice_77` `ice_76` `ice_75` `ice_74` `ice_73` `ice_72` `ice_71` `ice_70` `ice_69` `ice_68` `ice_67` `ice_66` `ice_65` `ice_64` `ice_63` `ice_62` `ice_61` `ice_60` `ice_59` `ice_58` `ice_57` `ice_56` `ice_55` `ice_54` `ice_53` `ice_52` `ice_51` `ice_50` `ice_49` `ice_48` `ice_47` `ice_46` `ice_45` `ice_44` `ice_43` `ice_42` `ice_41` `ice_40` `ice_39` `ice_38` `ice_37` `ice_36` `ice_35` `ice_34` `ice_92` `ice_90` `ice_33` `ice_32` `ice_31` `ice_91` `ice_30` `ice_29` `ice_28` `ice_27` `ice_26` `ice_23` `ice_25` `ice_24` `ice_22` `ice_21` `ice_20` `ice_19` `ice_18` `ice_17` `ice_16` `ice_15` `ice_14` `ice_13` `ice_12` `ice_11` `ice_10` `ice_9` `ice_8` `ice_7` `ice_6` `ice_5` `ice_4` `glow_0` `glow_1` `glow_2` `glow_3` `glow_4` |


## 約束

- 無。

## 網格與權重

- 其他 93 個部件：依人工密度建網格，整片跟著所在的骨。

## 動畫

### Idle_LV4（120 幀）

- 起始姿勢：setup 姿勢沒動，這段動畫的姿勢是 `body`、`ice_87`、`ice_86`、`ice_85`、`ice_84`、`ice_81`、`ice_77`、`ice_76`、`ice_75`、`ice_71`、`ice_70`、`ice_69`、`ice_68`、`ice_66`、`ice_65`、`ice_63`、`ice_62`、`ice_61`、`ice_60`、`ice_59`、`ice_58`、`ice_56`、`ice_55`、`ice_54`、`ice_50`、`ice_49`、`ice_48`、`ice_45`、`ice_42`、`ice_41`、`ice_40`、`ice_39`、`ice_38`、`ice_37`、`ice_36`、`ice_35`、`ice_34`、`ice_33`、`ice_32`、`ice_31`、`ice_28`、`ice_27`、`ice_26`、`ice_23`、`ice_25`、`ice_24`、`ice_22`、`ice_21`、`ice_20`、`ice_19`、`ice_18`、`ice_17`、`ice_15`、`ice_10`、`ice_9`、`ice_8`、`ice_7`、`ice_6`、`ice_5`、`ice_4`、`glow_2`、`glow_3`、`glow_4` 在每個關鍵幀上的固定偏移。改姿勢就改這些骨的關鍵幀（第 0 幀與最後一幀同值）。
- 部件組：顯示 93 個 slot，用 attachment 關鍵幀切換。
- 主動作：`body` 的 translate，對稱呼吸；幅度改第 60 幀的值。
- 共 63 根骨有關鍵幀，都是稀疏關鍵幀加貝茲曲線，可以直接拖動。

### 4Upgrade（55 幀，單次）

- 單次動畫：不循環，最後一幀不必等於第 0 幀；換圖和顏色停在最後的值，主動作在最後一幀回到原位。
- 起始姿勢：setup 姿勢沒動，這段動畫的姿勢是 `body`、`ice_87`、`ice_86`、`ice_85`、`ice_84`、`ice_77`、`ice_76`、`ice_75`、`ice_71`、`ice_70`、`ice_69`、`ice_68`、`ice_66`、`ice_65`、`ice_62`、`ice_61`、`ice_60`、`ice_59`、`ice_58`、`ice_56`、`ice_55`、`ice_54`、`ice_50`、`ice_49`、`ice_48`、`ice_45`、`ice_42`、`ice_41`、`ice_40`、`ice_39`、`ice_38`、`ice_37`、`ice_36`、`ice_35`、`ice_34`、`ice_33`、`ice_32`、`ice_31`、`ice_28`、`ice_27`、`ice_26`、`ice_23`、`ice_25`、`ice_24`、`ice_22`、`ice_21`、`ice_20`、`ice_19`、`ice_18`、`ice_17`、`ice_10`、`ice_9`、`ice_8`、`ice_7`、`ice_6`、`ice_5`、`ice_4`、`glow_2`、`glow_3`、`glow_4` 在每個關鍵幀上的固定偏移。改姿勢就改這些骨的關鍵幀（第 0 幀與最後一幀同值）。
- 關鍵姿勢：依參考圖在第 0、4、8、13、19、24、32、34、36、38、45、55 幀擺的姿勢（`body`、`ice_88`、`ice_87`、`ice_86`、`ice_85`、`ice_84`、`ice_81`、`ice_77`、`ice_76`、`ice_75`、`ice_71`、`ice_70`、`ice_69`、`ice_68`、`ice_66`、`ice_65`、`ice_62`、`ice_61`、`ice_60`、`ice_59`、`ice_58`、`ice_56`、`ice_55`、`ice_54`、`ice_50`、`ice_49`、`ice_48`、`ice_46`、`ice_45`、`ice_42`、`ice_41`、`ice_40`、`ice_39`、`ice_38`、`ice_37`、`ice_36`、`ice_35`、`ice_34`、`ice_33`、`ice_32`、`ice_31`、`ice_28`、`ice_27`、`ice_26`、`ice_23`、`ice_25`、`ice_24`、`ice_22`、`ice_21`、`ice_20`、`ice_19`、`ice_18`、`ice_17`、`ice_16`、`ice_15`、`ice_14`、`ice_13`、`ice_10`、`ice_9`、`ice_8`、`ice_7`、`ice_6`、`ice_5`、`ice_4`），疊在主動作、跟隨和波動之上。改姿勢就改這些幀上的關鍵幀；兩者都動的骨在那段是逐幀的鍵。
- 部件組：顯示 93 個 slot，用 attachment 關鍵幀切換。
- 主動作：`body` 的 translate，對稱呼吸；幅度改第 28 幀的值。
- 共 67 根骨有關鍵幀，都是稀疏關鍵幀加貝茲曲線，可以直接拖動。

### Trigger_Fail_Lv4（30 幀，單次）

- 單次動畫：不循環，最後一幀不必等於第 0 幀；換圖和顏色停在最後的值，主動作在最後一幀回到原位。
- 起始姿勢：setup 姿勢沒動，這段動畫的姿勢是 `body`、`ice_87`、`ice_86`、`ice_85`、`ice_77`、`ice_76`、`ice_75`、`ice_71`、`ice_70`、`ice_69`、`ice_68`、`ice_66`、`ice_65`、`ice_63`、`ice_62`、`ice_61`、`ice_60`、`ice_59`、`ice_58`、`ice_55`、`ice_54`、`ice_50`、`ice_49`、`ice_48`、`ice_45`、`ice_42`、`ice_41`、`ice_40`、`ice_39`、`ice_38`、`ice_37`、`ice_36`、`ice_35`、`ice_34`、`ice_33`、`ice_32`、`ice_31`、`ice_28`、`ice_27`、`ice_26`、`ice_23`、`ice_25`、`ice_24`、`ice_22`、`ice_21`、`ice_20`、`ice_19`、`ice_18`、`ice_17`、`ice_10`、`ice_9`、`ice_8`、`ice_7`、`ice_6`、`ice_5`、`ice_4`、`glow_2`、`glow_3`、`glow_4` 在每個關鍵幀上的固定偏移。改姿勢就改這些骨的關鍵幀（第 0 幀與最後一幀同值）。
- 部件組：顯示 93 個 slot，用 attachment 關鍵幀切換。
- 主動作：`body` 的 translate，對稱呼吸；幅度改第 15 幀的值。
- 共 59 根骨有關鍵幀，都是稀疏關鍵幀加貝茲曲線，可以直接拖動。

## 常見調整

- 整體幅度：改 `body` 的關鍵幀。
- 頭的點頭：改 `head` 的 rotate 關鍵幀。
- 頭髮、尾巴的擺動：改骨鏈的 rotate 關鍵幀。
- 網格與權重：Spine 的 Weights 面板可以直接重刷；新增骨就照關節命名接到對應的父骨。

