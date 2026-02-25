require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
} = require("discord.js");

const axios = require("axios");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", () => {
  console.log("BOT Ready");
});

/* ===============================
   メイン処理
=================================*/
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "search") return;

  const platform = interaction.options.getString("platform");
  const channelInput = interaction.options.getString("channel");
  const datetimeInput = interaction.options.getString("datetime");

  await interaction.deferReply();

  const targetDate = parseDate(datetimeInput);
  if (!targetDate) {
    return interaction.editReply("日時の形式が正しくありません");
  }

  try {
    let result;

    if (platform === "yt") {
      result = await searchYouTube(channelInput, targetDate);
    } else {
      result = await searchTwitch(channelInput, targetDate);
    }

    if (!result) {
      return interaction.editReply("該当時間の配信はありませんでした");
    }

    const embed = new EmbedBuilder()
      .setTitle(result.title)
      .setDescription(
    `${result.channel}
    ${result.start} ~ ${result.end}
    \`\`\`${result.url}\`\`\``
      )
      .setColor(platform === "yt" ? 0xff0000 : 0x9146ff);

      await interaction.editReply({
        embeds: [embed],
      });

  } catch (err) {
    console.error(err);
    interaction.editReply("エラーが発生しました");
  }
});

/* ===============================
   日時パース（JST → UTC変換）
=================================*/
function parseDate(input) {
  const formats = [
    "YYYY-MM-DD HH:mm",
    "YYYY/MM/DD HH:mm",
    "YYYY-MM-DD",
    "YYYY/MM/DD",
  ];

  for (const f of formats) {
    const d = dayjs(input, f, true);
    if (d.isValid()) {
      return d.utc();
    }
  }
  return null;
}

/* ===============================
   YouTube検索（ゆる検索Lv2）
=================================*/
async function searchYouTube(channelName, targetDate) {

  // チャンネル検索（最大10件）
  const channelRes = await axios.get(
    "https://www.googleapis.com/youtube/v3/search",
    {
      params: {
        part: "snippet",
        type: "channel",
        q: channelName,
        maxResults: 10,
        key: process.env.YOUTUBE_API_KEY,
      },
    }
  );

  if (!channelRes.data.items.length) return null;

  // 🔥 ゆる一致ロジック
  const normalizedInput = normalize(channelName);

  const bestMatch = channelRes.data.items.find(c =>
    normalize(c.snippet.channelTitle).includes(normalizedInput)
  ) || channelRes.data.items[0];

  const channelId = bestMatch.id.channelId;

  const dayStart = targetDate.startOf("day").toISOString();
  const dayEnd = targetDate.endOf("day").toISOString();

  const videosRes = await axios.get(
    "https://www.googleapis.com/youtube/v3/search",
    {
      params: {
        part: "snippet",
        channelId,
        type: "video",
        publishedAfter: dayStart,
        publishedBefore: dayEnd,
        maxResults: 50,
        key: process.env.YOUTUBE_API_KEY,
      },
    }
  );

  if (!videosRes.data.items.length) return null;

  // 🔥 詳細を一括取得（quota節約）
  const videoIds = videosRes.data.items.map(v => v.id.videoId).join(",");

  const detailRes = await axios.get(
    "https://www.googleapis.com/youtube/v3/videos",
    {
      params: {
        part: "liveStreamingDetails,snippet",
        id: videoIds,
        key: process.env.YOUTUBE_API_KEY,
      },
    }
  );

  for (const data of detailRes.data.items) {
    if (!data.liveStreamingDetails) continue;

    const start = dayjs.utc(data.liveStreamingDetails.actualStartTime);
    const end = dayjs.utc(data.liveStreamingDetails.actualEndTime);

    if (
      targetDate.isAfter(start) &&
      targetDate.isBefore(end)
    ) {
      return {
        title: data.snippet.title,
        channel: data.snippet.channelTitle,
        start: start.local().format("YYYY/MM/DD HH:mm:ss"),
        end: end.local().format("YYYY/MM/DD HH:mm:ss"),
        url: `https://youtube.com/watch?v=${data.id}`,
      };
    }
  }

  return null;
}

/* ===============================
   Twitch検索（最大50件）
=================================*/
async function searchTwitch(channelName, targetDate) {

  const tokenRes = await axios.post(
    "https://id.twitch.tv/oauth2/token",
    null,
    {
      params: {
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        grant_type: "client_credentials",
      },
    }
  );

  const accessToken = tokenRes.data.access_token;

  const userRes = await axios.get(
    "https://api.twitch.tv/helix/users",
    {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${accessToken}`,
      },
      params: { login: channelName },
    }
  );

  if (!userRes.data.data.length) return null;
  const userId = userRes.data.data[0].id;

  const videosRes = await axios.get(
    "https://api.twitch.tv/helix/videos",
    {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${accessToken}`,
      },
      params: { user_id: userId, type: "archive", first: 50 },
    }
  );

  for (const v of videosRes.data.data) {
    const start = dayjs.utc(v.created_at);
    const durationSec = parseDuration(v.duration);
    const end = start.add(durationSec, "second");

    if (
      targetDate.isAfter(start) &&
      targetDate.isBefore(end)
    ) {
      return {
        title: v.title,
        channel: v.user_name,
        start: start.local().format("YYYY/MM/DD HH:mm:ss"),
        end: end.local().format("YYYY/MM/DD HH:mm:ss"),
        url: v.url,
      };
    }
  }

  return null;
}

/* ===============================
   Twitch時間変換
=================================*/
function parseDuration(duration) {
  const h = duration.match(/(\d+)h/)?.[1] || 0;
  const m = duration.match(/(\d+)m/)?.[1] || 0;
  const s = duration.match(/(\d+)s/)?.[1] || 0;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/* ===============================
   文字列正規化（ゆる検索用）
=================================*/
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\wぁ-んァ-ン一-龯]/g, "");
}

client.login(process.env.DISCORD_TOKEN);