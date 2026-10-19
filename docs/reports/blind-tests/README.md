# AutoSpine 盲測報告

成績以 2026-10-17 起用目前引擎重測的 4 個角色、18 段動畫為準，並附製作流程與對照影片。

[完整 HTML 報告](autospine-blind-report.html) · [下載專案 ZIP](https://github.com/Wayne188-yiching/AutoSpine/archive/refs/heads/main.zip)

GitHub 會顯示 HTML 原始碼。下載並解壓後，開啟根目錄的 `autospine-blind-report.html`，即可瀏覽報告數據與縮圖。最新 ZIP 不含測試影片；HTML 中的影片播放器需先還原影片才能播放。

要給別台電腦看：在有影片的本機執行 `node tools/pack-blind-report.mjs`，會產生 `docs/local-reviews/autospine-blind-report-portable.zip`（報告與所有連到的圖片、影片、數據）。對方解壓後雙擊 `autospine-blind-report.html` 即可，不需架伺服器。ZIP 含美術影片，請只用內部管道傳遞。

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

成績以重測的 4 個角色為準，2026-10-13–14 的舊批次成績不再採用。4 個角色製作時都參考了原作，屬樣本內，還不是未見原作的盲測。

報告中的 15 個角色列為未來測試樣本，目前均待測試。

## 目前成績（2026-10-17–19）

| 角色                     | 段數 | 結果             | 通過項 |
| ------------------------ | ---- | ---------------- | ------ |
| 木乃伊貓（10-19）        | 5    | 參考比對未通過   | 5/18   |
| Panda（10-18）           | 5    | 參考比對通過     | 18/18  |
| 被窩上班族 Idle（10-18） | 1    | 參考比對未通過   | 2/4    |
| Pig（10-17）             | 7    | 人工檔比對未通過 | 46/54  |

木乃伊貓、Panda、被窩上班族共 11 段的參考影片比對：

| 檢查項目   | 通過 |
| ---------- | ---- |
| 輪廓       | 6/11 |
| 部件位置   | 5/11 |
| 節奏與幅度 | 7/11 |
| 循環接點   | 6/6  |

尚無任何一段獲美術驗收。量化檢查通過不代表美術驗收完成，仍需看影片確認。

## 網格與骨架

![自動佈線](report-assets/flow-3-mesh.jpg)

![自動骨架](report-assets/flow-3-bones.jpg)
