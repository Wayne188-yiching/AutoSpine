# AutoSpine 盲測報告

包含 73 段盲測動畫的成績、製作流程，以及人工版與 AutoSpine 的對照影片。

[完整 HTML 報告](autospine-blind-report.html) · [下載專案 ZIP](https://github.com/Wayne188-yiching/AutoSpine/archive/refs/heads/main.zip)

GitHub 會顯示 HTML 原始碼。下載並解壓後，開啟根目錄的 `autospine-blind-report.html`，即可瀏覽完整報告及離線播放影片。

## 成績摘要

- 73 段動畫，涵蓋循環、進場、退場、勝利與特效。
- 15 個角色各整合為一個 Spine 專案。
- Spine 4.0.64 匯入再匯出的最大座標誤差為 0.13 px。

其中批次 68 段動畫的通過率：

| 檢查項目       | 通過率 |
| -------------- | ------ |
| 擺位與循環接縫 | 100%   |
| 網格變形       | 96%    |
| 動到對的部件   | 96%    |
| 起始姿勢       | 51%    |
| 動作風格       | 17%    |

以上為原報告數據。量化檢查通過不代表美術驗收完成，仍需看影片確認。

## 影片範例

- [大野狼 idle](2026-10-14-batch/wolf3p/video/wolf3p-02_Idle-review.mp4)
- [麋鹿 idle](2026-10-14-batch/moose/video/moose-Idle-review.mp4)
- [獎盃 Wind](2026-10-14-batch/trophy_Gold/video/trophy_Gold-Wind-review.mp4)
- [大野狼勝利 Win](2026-10-14-batch/wolf3p/video/wolf3p-Win-review.mp4)

完整影片清單見 HTML 報告。每支影片依序呈現網格、骨架與完整動態，左為人工版、右為 AutoSpine。

## 網格與骨架

![自動佈線](report-assets/flow-3-mesh.jpg)

![自動骨架](report-assets/flow-3-bones.jpg)
