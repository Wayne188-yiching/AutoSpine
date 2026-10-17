# AutoSpine 盲測報告

包含 73 段盲測動畫的成績與製作流程。對照影片的動作多數和人工版差很多，已先下架，改進後重新盲測。

[完整 HTML 報告](autospine-blind-report.html) · [下載專案 ZIP](https://github.com/Wayne188-yiching/AutoSpine/archive/refs/heads/main.zip)

GitHub 會顯示 HTML 原始碼。下載並解壓後，開啟根目錄的 `autospine-blind-report.html`，即可瀏覽完整報告。

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

## 網格與骨架

![自動佈線](report-assets/flow-3-mesh.jpg)

![自動骨架](report-assets/flow-3-bones.jpg)
