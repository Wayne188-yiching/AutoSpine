<!-- Generated from skills/autospine/references/controls-animation.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# 約束、控制器、動態與交付

在[能力表](production-workflow.md)確認工具實際可用範圍，再使用以下規則。來源為 76 部完整 ASR 研讀與官方原理核對，非全程影音觀看或課程範例品質認證。

## IK 與控制器

- 明列每個控制的通道、作用骨、父級、座標空間、setup offset、可動範圍和接觸位置。檢查依賴圖、求值順序、循環與重複驅動。
- 一／二骨 IK 使用相連骨，target 不在受約束鏈後代；核對 bend、mix、可達／不可達、近伸直、body 位移及 FK／IK 轉接。足掌位置和朝向分開驗收。[官方 IK](https://esotericsoftware.com/spine-ik-constraints)
- 關閉 IK mix 不代表腳自動隨腿：重新核對腳的父級、方向控制和繼承模式。鏡像及縮放也測。
- Transform 指定 local/world、relative/absolute、各通道 mix 與 offset。只需跟隨位移的眼球不可順便鎖住獨立視線。局部權重百分比只能作初值，需實際求值。[官方 Transform](https://esotericsoftware.com/spine-transform-constraints)
- Path 的 target 是 slot 的可見 Path attachment，非圖片中線。指定 position／spacing 單位、rotate mode、骨順序和 hierarchy 限制，檢查切線、轉彎與長剛性物體的角速度。[官方 Path](https://esotericsoftware.com/spine-path-constraints)
- root anchor、body 位移、旋轉中心、尾巴方向補償、柔性擺動分工。偏心旋轉先修 pivot，不以增加鍵掩蓋抖動。
- 中立 baked pose 與原生可編輯 constraint 分別標示。課程負 mix、softness、stretch、關閉繼承等依實際版本和求解器支援，不照搬歷史 H5 限制。
- IK 可達性須包含身體最高／最低與傾斜姿勢。先檢查實際鏈長和目標距離，再判斷殘差；非均勻祖先縮放另測。角色壓縮可放在 torso mesh deform，避免把手臂控制空間也壓扁。鏡像掌向同時檢查 bind 朝向與旋轉增量。

## 主體、接觸與次要動態

1. 先通過 setup、控制活動範圍，再建立主體關鍵姿勢與節奏。主體修改後，原有接觸和次要動態驗收失效，重新檢查。
2. 非循環動作分預備、發力／命中、保持、緩衝、恢復；按觸發需求選立即反應或完整展示。用到位時間、停留時間、方向與幅度讓動作意圖可讀，不能只平滑曲線。
3. 每階段區分主動關節、被動慣性與固定接觸。頭頸、手與尾巴可在不同階段改角色，不能整條骨鏈永遠套固定延遲。
4. 驗腳底、手掌、武器握點及兩手共同接觸。退步抬離地再落地；發力伸直後才離地。接觸要求依動作 brief；以輪廓端和世界位置驗收，非僅骨點。
5. 按材質與力的傳遞配置 follow-through。髮布、金屬鏈、盔甲、煙霧使用不同反應；兩手握同物不任意錯幀。次要動態不搶主動作焦點。
6. 復用 idle 前確認受力、父級與控制空間相容；錯誤模板重建。判斷真正極值與導數，不以「曲線緩入」刪除所有中間鍵。
7. 分離 bone T/R/S、slot attachment/color、deform、constraints、draw order、events。新通道的初值、末值和清除方式符合 Runtime 混合契約，不強制每動畫全鍵。
8. Follow-through 對指定部件的有序骨鏈取樣（`generatePreset` 的 `boneIds`），延遲與衰減以該链的索引計算；插入無關控制骨不應改變尾巴或布條的振幅。拍手以帶 alpha 的輪廓接觸和過深重疊驗收，不能只檢查兩個 target 的距離。

循環測 start/end pose、velocity、phase wrap 和根部／接觸漂移；播放取 `[start,end)` 避免重複末格。`in→idle` 等轉接同時測姿勢與速度，retime 後兩邊重驗。累積旋轉保留方向，測實際 Runtime 的角度混合。

脫手／飛出物需獨立控制空間，交接前後世界姿勢、朝向和可見性一致；附着→飛行→收回都測。多個重複衝擊檢查累積作用，不每個實例都強抖主體。參考[官方動畫套用說明](https://esotericsoftware.com/spine-applying-animations)：clear track 可留下當前姿勢，並不等於恢復 setup；混合、empty animation 和 keyed 通道須按播放端測。

## FX、UI 與資源

- 明列效果實體、受眾、錨點、座標空間、事件名與觸發時點。預延遲、event 或配置表選明確契約，避免雙重延遲。動畫名稱不自動轉成 events。
- Spine 4.0 序列使用附件切換；原生 Sequence 功能屬 4.1 以後，不能直接混用。每 slot 同時最多一個附件；null 是合法隱藏狀態。[官方附件](https://esotericsoftware.com/spine-attachments)
- 同系列保留畫布與 offset。透明 PNG 是否需排除依實際工具，不刪原圖；不可將 null 與空白圖片混為一談。alpha0 期間可復位，但檢查可見前後及重觸發。
- 先完成含初始、末段和可見狀態的粒子模板再複用；固定隨機種子，非同時重複可重用，別無謂複製骨。降低序列幀數或解析度需比較品質、包體、記憶體。
- light 核對 blend、tint、alpha、draw order 與實際背景；不同 Runtime 的 additive/PMA 能力決定分組，不套用課程整骨架限制。
- UI 保護文字／分數可讀性，背景縮放與字分開控制；先定焦點，後景與飾物幅度服務主體。數值由接收端提供，演示數字不冒充正式輸出。
- Clipping 檢查 polygon、end slot、draw order 範圍與成本，不以一張白底圖確認效果。[官方 Clipping](https://esotericsoftware.com/spine-clipping)
- 固定舞台遮罩放在場景控制骨，角色 root 在其下移動／縮放；進場時檢查遮罩世界座標保持固定。原始模糊白色光圖須保留實際 tint、alpha、blend 和效果錨點。

## 驗收與交付

保留原檔，生成到新目錄；凍結候選再打開人工基準比較。工程格式、骨架功能、變形、表演品質、Runtime 整合分別判定，失敗與未驗證項目保留。

用相同 Editor／Runtime 主次版本做官方匯入／匯出，核對附件和動畫名字、同批 atlas／PNG、scale、UV、PMA/shader。逐動畫看正常／快慢速、鏡像、切換與末段；官方 round-trip 成功不等於表演品質通過。[官方匯出](https://esotericsoftware.com/spine-export)

自動判定由使用者委託的助手執行。展示通過、未通過、待判定及具體理由；不因 Skill 更新、課程讀完或產生五個名字就把品質標綠。
