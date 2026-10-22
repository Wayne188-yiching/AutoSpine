# AutoSpine 盲測報告

成績以 2026-10-17 起用目前引擎重測的 4 個角色、18 段動畫為準，並附製作流程與對照影片。

[完整 HTML 報告](autospine-blind-report.html) · [下載專案 ZIP](https://github.com/Wayne188-yiching/AutoSpine/archive/refs/heads/main.zip)

GitHub 會顯示 HTML 原始碼。下載並解壓後，開啟本資料夾的 `autospine-blind-report.html`，即可瀏覽報告數據、縮圖並播放影片。

要給別台電腦看：在有影片的本機執行 `node tools/pack-blind-report.mjs`，會產生 `docs/local-reviews/autospine-blind-report-portable.zip`（報告與所有連到的圖片、影片、數據）。對方解壓後雙擊 `autospine-blind-report.html` 即可，不需架伺服器。ZIP 含美術影片，請只用內部管道傳遞。

## 影片

GitHub 只放報告上有出現的影片：主報告 26 支、Panda 驗收頁 5 支，放在各角色的 `video/` 與 `compare/` 資料夾。其他測試影片與製作檔不放 GitHub，請存放在 `docs/local-reviews/`。

報告資料夾下的 `.mp4` 仍列在 `.gitignore`，新增報告影片時用 `git add -f` 逐支加入，只收報告引用到的檔案。

## 目前狀態

成績以重測的 4 個角色為準，2026-10-13–14 的舊批次成績不再採用。4 個角色製作時都參考了原作，屬樣本內，還不是未見原作的盲測。

報告中的 15 個角色列為未來測試樣本，目前均待測試。

## 目前成績（2026-10-17–19）

| 角色                     | 段數 | 結果             | 通過項 |
| ------------------------ | ---- | ---------------- | ------ |
| Panda（10-18）           | 5    | 參考比對通過     | 18/18  |
| 被窩上班族 Idle（10-18） | 1    | 參考比對未通過   | 2/4    |
| Pig（10-17）             | 7    | 人工檔比對未通過 | 46/54  |
| 木乃伊貓（10-19）        | 5    | 參考比對未通過   | 8/18   |

木乃伊貓、Panda、被窩上班族共 11 段的參考影片比對：

| 檢查項目   | 通過 |
| ---------- | ---- |
| 輪廓       | 7/11 |
| 部件位置   | 5/11 |
| 節奏與幅度 | 9/11 |
| 循環接點   | 6/6  |

尚無任何一段獲美術驗收。量化檢查通過不代表美術驗收完成，仍需看影片確認。

## 網格與骨架

![自動佈線](report-assets/flow-3-mesh.jpg)

![自動骨架](report-assets/flow-3-bones.jpg)
