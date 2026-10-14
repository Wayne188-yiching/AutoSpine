# AutoSpine 使用說明

給它一個只有圖片的 Spine 檔和一句動作需求。它會自動做出骨架、網格、權重和動作，輸出 Spine 4.0.64 可以直接開的檔案，再附一支檢查用的影片。

## 準備（第一次）

1. 安裝 Node.js 22.12 以上、Spine 4.0.64（含命令列 `Spine.com`）、ffmpeg。
2. 在 AutoSpine 資料夾執行：

   ```text
   npm install
   npm run build
   ```

## 使用

在 Claude Code 或 Codex 開啟 AutoSpine 資料夾，直接說：

```text
用 autospine 技能，把 D:\素材\角色\角色.spine 的 idle 做成 2 秒呼吸，手扶著額頭不動，輸出到 D:\輸出\角色
```

要和人工做好的版本比對時，加一句：

```text
和 D:\素材\角色\人工版.spine 比對
```

**需求寫清楚這幾點，結果會好很多：**

- 動畫名稱與長度。
- 一個 Spine 檔有多組姿勢時，這個動畫用哪一組（例如「用 Drop 那組」）。
- 手的狀態：拿著道具，或靠在桌面、額頭上。
- 道具類（樹、旗子）要擺多大。
- 要不要眨眼、眼神移動。

## 你會拿到

| 檔案                       | 用途                                                                       |
| -------------------------- | -------------------------------------------------------------------------- |
| `<名稱>.json` 與 `images/` | Spine 檔。在 Spine 選 Import Data 匯入即可                                 |
| `review.mp4`               | 檢查影片，依序播放：① 佈線 ② 骨架 ③ 完整動態。有人工版時左為人工、右為自動 |
| `acceptance-check.json`    | 有人工版時才有的驗收結果                                                   |

用命令列轉成 Spine 專案：

```text
"C:\Program Files\Spine\Spine.com" -u 4.0.64 -i <名稱>.json -o <新專案>.spine -r
```

## 怎麼看驗收結果

| 項目 | 檢查什麼                                       |
| ---- | ---------------------------------------------- |
| A    | 圖片擺位、循環接得上                           |
| B    | 網格有沒有翻折、接縫有沒有裂開、拉伸有沒有過度 |
| C    | 該動的部件有沒有動                             |
| D    | 動作的時間與幅度接近人工                       |

全部 PASS 只代表數字上接近人工，最後仍要看影片確認。

## 修改

看完影片，直接說哪裡不對，例如：

```text
拐杖要跟著手動
樹冠擺動再大一點
臉不要一直滑動
```

它會改方案、重建，再給新的影片。

## 目前做不到

- 同一個動畫中途換圖（眨眼、嘴型、閃光序列）。
- 顏色對不對不在自動驗收內，要看影片。
- 沒給需求的部分會用預設值：角色是輕微呼吸，道具的擺幅偏小。

## 手動指令（不經過 AI）

```text
node packages/cli/dist/index.js strip-images <人工.json> <images資料夾> <新的 imagesOnly.json>
node packages/cli/dist/index.js lint-plan <plan.json>
node packages/cli/dist/index.js build-character <plan.json> <新資料夾>
node packages/cli/dist/index.js compare-reference <plan.json> <建置資料夾> <人工.json> <新資料夾>
node packages/cli/dist/index.js review-video <plan.json> <建置資料夾> [<人工.json>] <新影片.mp4>
```

方案檔（`plan.json`）的寫法見 [CHARACTER_PLAN.md](CHARACTER_PLAN.md)。
