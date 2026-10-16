# AutoSpine

AutoSpine 用來製作 Spine 角色的骨架與動畫。提供已拆圖、擺好位置的 Spine 專案和動作需求，透過 Claude 或 Codex 操作，產出可繼續編輯的 Spine 專案與檢查影片。

[安裝指南](docs/INSTALL.html) · [使用說明](docs/USER_GUIDE.md) · [盲測報告與影片](docs/reports/blind-tests/README.md)

## 開始使用

1. 安裝 AutoSpine 外掛。電腦需有 Node.js 22.12 以上；輸出 Spine 專案與影片另需 Spine 4.0.64 和 ffmpeg。
2. 準備角色的 `.spine` 檔及圖片資料夾。
3. 在 Claude Code、Cowork 或 Codex 說明要做的動作，例如：

   ```text
   用 autospine 把 D:\素材\角色\角色.spine 的 idle 做成 2 秒循環呼吸，手扶著額頭不動，輸出到 D:\輸出\角色
   ```

看完檢查影片，直接說要修改哪裡，例如「頭部擺動小一點」或「拐杖跟著手動」。

## 交付內容

| 檔案           | 用途                                     |
| -------------- | ---------------------------------------- |
| `<名稱>.spine` | 在 Spine 4.0.64 開啟，可繼續修改         |
| `<名稱>.mp4`   | 檢查網格、骨架與動畫；有人工版時並排比對 |
| `images/`      | 專案使用的圖片，交付時需一起保留         |
| `_work/`       | 方案、建置與比對紀錄，之後重做時使用     |

處理時使用原檔的副本。沒有安裝 Spine 時，會提供 JSON，需用 Spine 的 Import Data 匯入。

## 使用前請注意

- 圖片部件需先拆好、擺好位置。
- 請說明動畫長度、是否循環，以及手和道具的狀態。單次動作建議附上標明幀數的關鍵姿勢圖。
- 目前不會依參考圖片自動產生表情或網格變形。完成後仍需看影片確認動作、接縫與變形。

## 開發與技術文件

[方案格式與手動指令](docs/CHARACTER_PLAN.md) · [MCP 工具](docs/MCP_ADAPTER.md) · [程式架構](ARCHITECTURE.md) · [開發紀錄](AUTOSPINE_DEVELOPMENT_WORKFLOW.md)

開發環境需有 Node.js 22.12 以上及 npm 12：

```text
npm install
npm run build
npm run verify
```

引擎或內附文件修改後，執行 `npm run build:plugin` 更新外掛，發布時同步提高外掛版本。

## 授權

本專案為私人專案，未開放授權。Spine 編輯器與 Runtime 依 Esoteric Software 的授權條款使用。
