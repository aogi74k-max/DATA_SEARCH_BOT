require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const command = new SlashCommandBuilder()
  .setName("search")
  .setDescription("日時指定で配信検索")
  .addStringOption(o =>
    o.setName("platform")
      .setDescription("yt or tw")
      .setRequired(true)
      .addChoices(
        { name: "YouTube", value: "yt" },
        { name: "Twitch", value: "tw" }
      ))
  .addStringOption(o =>
    o.setName("channel")
      .setDescription("チャンネル名")
      .setRequired(true))
  .addStringOption(o =>
    o.setName("datetime")
      .setDescription("例: 2026-02-14 00:20 / 2/14 0:20 / 0:20")
      .setRequired(true));

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Guildコマンド登録中...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: [command.toJSON()] }
    );

    console.log("Guild登録完了！（即時反映）");
  } catch (error) {
    console.error(error);
  }
})();