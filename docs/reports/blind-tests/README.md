# AutoSpine 盲測報告

包含 73 段盲測動畫的成績與製作流程。對照影片的動作多數和人工版差很多，已先下架，改進後重新盲測。

[完整 HTML 報告](autospine-blind-report.html) · [下載專案 ZIP](https://github.com/Wayne188-yiching/AutoSpine/archive/refs/heads/main.zip)

GitHub 會顯示 HTML 原始碼。下載並解壓後，開啟根目錄的 `autospine-blind-report.html`，即可瀏覽報告數據與縮圖。最新 ZIP 不含測試影片；HTML 中的影片播放器需先還原影片才能播放。

## 歷史影片

107 支測試影片（約 498 MiB）保留於固定歷史版本 [`d3b1ab2`](https://github.com/Wayne188-yiching/AutoSpine/tree/d3b1ab2edfed935cb2efe3efbd74570f663abedd/docs/reports/blind-tests)，不再隨最新版下載或更新。原始報告 HTML、驗收數據與縮圖保留不變。

已有完整 Git 歷史時，在專案根目錄執行：

```text
git restore --source=d3b1ab2edfed935cb2efe3efbd74570f663abedd --worktree -- ":(glob)docs/reports/**/*.mp4"
```

若是淺層複製，需先取得該歷史版本（會下載影片），再執行上面的還原指令：

```text
git fetch origin d3b1ab2edfed935cb2efe3efbd74570f663abedd
```

若使用 ZIP，可[下載含影片的歷史 ZIP](https://github.com/Wayne188-yiching/AutoSpine/archive/d3b1ab2edfed935cb2efe3efbd74570f663abedd.zip)，或從歷史目錄下載需要的影片，放回原本相對路徑。

還原的影片已列入 `.gitignore`，一般提交不會重新收錄。新的測試影片請存放在 `docs/local-reviews/`，需要分享時使用獨立附件，報告中保留連結。

## 目前狀態

盲測待改進後重測。頁面展示的 3 件參考仿作另列，不計入盲測成績。

報告中的 15 個角色列為未來測試樣本，目前均待測試。

## 歷史成績（2026-10-13–14）

- 73 段動畫，涵蓋循環、進場、退場、勝利與特效。
- Spine 4.0.64 匯入再匯出的最大座標誤差為 0.13 px。

其中 2026-10-14 批次 68 段動畫的通過率：

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
