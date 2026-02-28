require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

/* ===============================
   環境変数チェック
=================================*/
if (!process.env.DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN が未設定です");
}

if (!process.env.CLIENT_ID) {
  throw new Error("CLIENT_ID が未設定です");
}

/* ===============================
   コマンド定義
=================================*/
const commands = [
  new SlashCommandBuilder()
    .setName("search")
    .setDescription("日時指定で配信検索")
    .addStringOption(o =>
      o.setName("platform")
        .setDescription("配信プラットフォーム")
        .setRequired(true)
        .addChoices(
          { name: "YouTube", value: "yt" },
          { name: "Twitch", value: "tw" }
        )
    )
    .addStringOption(o =>
      o.setName("channel")
        .setDescription("チャンネル名")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("datetime")
        .setDescription("例: 2026-02-14 00:20 / 2/14 0:20 / 0:20")
        .setRequired(true)
    )
    .toJSON()
];

/* ===============================
   REST初期化
=================================*/
const rest = new REST({ version: "10" })
  .setToken(process.env.DISCORD_TOKEN);

/* ===============================
   登録処理
=================================*/
(async () => {
  try {
    console.log("コマンド登録開始...");

    // Guild登録（即時反映）
    if (process.env.GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(
          process.env.CLIENT_ID,
          process.env.GUILD_ID
        ),
        { body: commands }
      );
      console.log("✅ Guildコマンド登録完了（即時反映）");
    } 
    // Global登録（最大1時間反映待ち）
    else {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );
      console.log("🌍 Globalコマンド登録完了（最大1時間で反映）");
    }

  } catch (error) {
    console.error("❌ コマンド登録エラー:", error);
  }
})();