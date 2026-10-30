# 動畫參考知識庫

用途：在 AutoSpine 的 Layout、Blocking、Final 製作時，檢索公開動畫與製作教材，輔助構圖、Pose、表演與動態判斷。這是可持續累積的參考筆記，不是重新訓練模型，也不以收錄數量代表美感提升。

收錄以 **Spine 動態展示影片** 為主：角色演出、遊戲實機、動作集與 showreel 優先，搭配有實際動作示範的製作教學；其他 2D／3D 動畫影片作次要參考，圖片與文字作補充。首頁預設只顯示「Spine 動態影片」，另可切換「2D／3D 動畫影片」「圖片與教材」或「全部」。既有圖片與筆記保留，繼續供製作時檢索。

- [開啟可搜尋分類目錄](index.html)
- [公開影片知識庫](https://wayne188-yiching.github.io/AutoSpine/)
- [結構化條目與分類](catalog.json)
- [每小時整理流程](CURATION.md)
- [Pose 優先製作流程](../../skills/autospine/references/pose-first-workflow.md)
- [每次執行紀錄](runs/)

分類包含地域（美國、歐洲、日本、跨國）、作品／發布者、媒材、製作階段與技法。地域用來記錄來源，不把整個地域當成單一畫風。每筆都有來源、查證時間、觀察範圍、自己的分析、推論出的 Spine 用法，以及不能由此判斷的事項。

`topic` 明確區分 `spine` 與 `animation`。只有來源能查證使用 Spine 的作品／Spine 本身的教學才列入前者，不能因為應用筆記提到 Spine 就改分類。舊資料未填 `topic` 時視為一般動畫參考。首頁的影片分類採可直接開啟播放器的 YouTube 原始影片；其他圖片、文章與含外部嵌入的教材列入補充資料。待研讀影片仍可播放，但不會出現在預設只搜尋已檢視筆記的 CLI 結果。

圖片另依動作類型（走跑、跳躍、閃避、翻身、踢擊、角色表演等）與參考圖形式（單張 Pose、連續姿勢、分鏡、動勢、表情、結構、節拍圖）分類。可點選圖片放大並回到原始來源；每筆保留作者／授權的已知範圍。原作者與地區無法確認時會明確標記，不將收藏者當作者，也不推定國別。圖片只保存公開連結及原創筆記，不包含使用者完整瀏覽器截圖或原圖打包檔。

閱讀狀態分成「僅來源」「已讀文字」「已看圖片」「畫面抽查」「連續片段檢視」。只找到片名／縮圖不算看過；畫面抽查不能證明動作速度或完整表演品質。首批內容刻意保留這些差別。影片時間碼指公開影片的位置，不是製作專案的幀號。

## 使用與維護

以下維護指令在 AutoSpine 原始碼專案根目錄執行；獨立外掛使用內附目錄／JSON 快照，不包含這支維護工具：

```text
node tools/animation-knowledge.mjs search silhouette
node tools/animation-knowledge.mjs search japan
node tools/animation-knowledge.mjs check
node tools/animation-knowledge.mjs build
node tools/animation-knowledge.mjs serve
node tools/publish-animation-knowledge.mjs
```

`search` 預設只列已檢視的資料；加 `--all` 可包含待研究來源。不輸入關鍵字可列出全部已檢視條目。`build` 從同一份 JSON 重建目錄，先驗證來源去重與證據欄位。

每次背景整理完會將知識庫與執行紀錄 Commit／Push 到原 GitHub 倉庫的 `main`，由 GitHub Actions 驗證、建置並部署到 GitHub Pages；公開網站只發布 `index.html` 與 `catalog.json`。發布工具使用獨立的暫存索引，保留本機 HEAD、暫存區與製作中的其他檔案；所以本機分支顯示落後遠端不等於上傳失敗。若需確認最後同步結果，可查看 `git rev-parse --git-path autospine-animation-publish.json` 指向的本機收據，或 GitHub 的部署紀錄。失敗會保留本機成果並通知；電腦離線或休眠期間仍無法保證執行蒐集與上傳。

目錄沿用盲測報告的墨色／深藍／暖橘視覺，含官方影片封面、播放入口及觀察時間碼。直接開 `index.html` 時，影片與時間碼會在 YouTube 開啟。需要頁內播放時，執行 `serve` 後開啟 `http://127.0.0.1:8767/`；只監聽本機，且只提供知識庫頁面。先點選影片才載入播放器，不預先播放。影片、封面需要網路；文字篩選仍可離線使用。片商禁止嵌入或平台無法播放時，可用卡片上的 YouTube 連結觀看。

製作前挑適合當前任務的參考，將「參考 ID → 觀察 → 本次做法」寫入階段紀錄／交接筆記；不要直接套知名作品的角色、鏡頭或完整動作。預覽結果仍要實際檢查。每小時排程只維護這個資料夾與其執行紀錄；不會自動修改正在製作的角色。外掛附帶的是建置時快照，本機此目錄才是持續更新來源。資料改變後，重新封裝外掛前要重建快照；外掛的 `--check` 會如實指出過期快照。
