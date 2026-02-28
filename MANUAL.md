# 配信日時検索 Discord BOT 仕様書 v1.0

---

## 1. システム概要

### ■ システム名
配信日時検索BOT

### ■ 目的
指定した日時に該当する **YouTube / Twitch の配信アーカイブ** を検索し、  
Discord上でEmbed形式で表示する。

---

## 2. 動作環境

| 項目 | 内容 |
|------|------|
| 実行環境 | Node.js 18以上 |
| Discordライブラリ | discord.js v14 |
| HTTP通信 | axios |
| 日付処理 | dayjs + utc + timezone |
| タイムゾーン | Asia/Tokyo（入力基準） |

---

## 3. 環境変数

`.env` に以下を設定する。

| 変数名 | 必須 | 説明 |
|--------|------|------|
| DISCORD_TOKEN | ○ | Discord Bot Token |
| CLIENT_ID | ○ | Discord Application ID |
| GUILD_ID | △ | Guild登録用（開発時のみ） |
| YOUTUBE_API_KEY | ○ | YouTube Data API v3 |
| TWITCH_CLIENT_ID | ○ | Twitch Developer Client ID |
| TWITCH_CLIENT_SECRET | ○ | Twitch Developer Secret |

---

## 4. コマンド仕様

### `/search`

日時指定で配信アーカイブを検索する。

### 引数

| 引数名 | 型 | 必須 | 説明 |
|--------|----|------|------|
| platform | string | ○ | yt / tw |
| channel | string | ○ | チャンネル名 |
| datetime | string | ○ | 指定日時 |

---

## 5. datetime入力フォーマット

対応形式：


YYYY-MM-DD HH:MM
YYYY/M/D H:mm
M/D H:mm
H:mm


### 入力例


2026-02-14 00:20
2/14 0:20
0:20


---

## 6. 日時処理仕様

### ■ 入力
JST（Asia/Tokyo）前提

### ■ 内部処理
- JSTとして解釈
- UTCへ変換
- APIのUTC時間と比較

### ■ 補完ルール

| 条件 | 処理 |
|------|------|
| 年なし | 当年補完 |
| 日付なし | 当日補完 |
| 未来日時 | 年を -1 して補正 |

---

## 7. YouTube検索仕様

### 使用API
YouTube Data API v3

### 処理フロー

1. チャンネル検索
2. チャンネルID取得
3. 指定日の動画検索
4. liveStreamingDetails取得
5. 配信時間と一致判定

### 判定条件


start <= targetDate <= end


### 制限事項

- チャンネル検索は曖昧一致（検索結果1位採用）
- 1日最大20件取得
- APIクォータ制限あり

---

## 8. Twitch検索仕様

### 使用API
Twitch Helix API

### トークン管理

- client_credentials 方式
- expires_in による有効期限管理
- 期限前自動更新
- 401発生時は強制再取得

### 処理フロー

1. トークン有効確認
2. ユーザー取得
3. アーカイブ動画取得（最大50件）
4. duration解析
5. 配信時間一致判定

### duration例


2h30m10s → 秒数変換


### 制限事項

- 直近50件のみ検索対象
- 古い配信は取得不可

---

## 9. Embed出力仕様

### 表示内容

- Author：チャンネル名
- アイコン：チャンネル画像
- タイトル：配信タイトル
- 説明：
  - 開始〜終了時間
  - 動画URL

### カラー

| プラットフォーム | 色 |
|------------------|----|
| YouTube | 赤 |
| Twitch | 紫 |

---

## 10. コマンド登録仕様

### Guildモード（開発用）

- 即時反映
- 指定サーバーのみ


Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)


### Globalモード（本番用）

- 全サーバー反映
- 最大1時間反映待ち


Routes.applicationCommands(CLIENT_ID)


### 切替条件

| GUILD_ID | 動作 |
|-----------|------|
| あり | Guild登録 |
| なし | Global登録 |

---

## 11. エラーハンドリング

| 状況 | 動作 |
|------|------|
| 日時不正 | フォーマットエラー表示 |
| 動画なし | 該当なし表示 |
| Twitch 401 | トークン再取得 |
| API例外 | エラーメッセージ表示 |

---

## 12. パフォーマンス設計

- deferReply使用（3秒制限回避）
- Twitchトークンキャッシュ
- UTC統一比較

---

## 13. セキュリティ

- APIキーは.env管理
- トークンはメモリ保持のみ
- ログに秘密情報を出力しない

---

## 14. 既知の制限

1. YouTubeチャンネル完全一致保証なし
2. Twitch 50件制限
3. APIクォータ依存
4. 終了未確定配信は現在時刻までとして扱う

---

## 15. 将来拡張案

- Twitchページネーション対応
- YouTubeハンドル対応
- Firestoreキャッシュ導入
- 履歴検索機能追加
- ボタンUI対応