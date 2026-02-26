require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
} = require("discord.js");

const axios = require("axios");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

let twitchToken = null;

/* ===============================
   起動時
=================================*/
client.once("ready", async () => {
  console.log("BOT Ready");
  twitchToken = await getTwitchToken();
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
    let result =
      platform === "yt"
        ? await searchYouTube(channelInput, targetDate)
        : await searchTwitch(channelInput, targetDate);

    if (!result) {
      return interaction.editReply("該当時間の配信はありませんでした");
    }

    const embed = new EmbedBuilder()
      .setAuthor({
        name: result.channelName,
        url: result.channelUrl,
        iconURL: result.channelIcon,
      })
      .setTitle(result.title)
      .setDescription(
        `🕒 ${result.start} - ${result.end}\n🔗 ${result.url}`
      )
      .setColor(platform === "yt" ? 0xff0000 : 0x9146ff);

    await interaction.editReply({ embeds: [embed] });

  } catch (err) {
    console.error(err);
    interaction.editReply("エラーが発生しました");
  }
});

/* ===============================
   日時パース（JST→UTC）
=================================*/
function parseDate(input) {
  const formats = [
    "YYYY-MM-DD HH:mm",
    "YYYY/MM/DD HH:mm",
    "YYYY-MM-DD",
    "YYYY/MM/DD",
  ];

  for (const f of formats) {
    const d = dayjs.tz(input, f, "Asia/Tokyo", true);
    if (d.isValid()) return d.utc();
  }
  return null;
}

/* ===============================
   YouTube検索（最適化版）
=================================*/
async function searchYouTube(channelName, targetDate) {

  // チャンネル検索
  const channelRes = await axios.get(
    "https://www.googleapis.com/youtube/v3/search",
    {
      params: {
        part: "snippet",
        type: "channel",
        q: channelName,
        maxResults: 5,
        key: process.env.YOUTUBE_API_KEY,
      },
    }
  );

  if (!channelRes.data.items.length) return null;

  const bestMatch = channelRes.data.items[0];
  const channelId = bestMatch.id.channelId;

  // チャンネル詳細（アイコン取得）
  const channelDetail = await axios.get(
    "https://www.googleapis.com/youtube/v3/channels",
    {
      params: {
        part: "snippet",
        id: channelId,
        key: process.env.YOUTUBE_API_KEY,
      },
    }
  );

  const channelData = channelDetail.data.items[0];
  const channelIcon = channelData.snippet.thumbnails.default.url;
  const channelUrl = `https://youtube.com/channel/${channelId}`;

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
        maxResults: 20,
        key: process.env.YOUTUBE_API_KEY,
      },
    }
  );

  if (!videosRes.data.items.length) return null;

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
    const end = data.liveStreamingDetails.actualEndTime
      ? dayjs.utc(data.liveStreamingDetails.actualEndTime)
      : dayjs.utc(); // 配信中対応

    if (
      (targetDate.isAfter(start) || targetDate.isSame(start)) &&
      (targetDate.isBefore(end) || targetDate.isSame(end))
    ) {
      return {
        title: data.snippet.title,
        channelName: channelData.snippet.title,
        channelIcon,
        channelUrl,
        start: start.local().format("YY/MM/DD HH:mm"),
        end: end.local().format("YY/MM/DD HH:mm"),
        url: `https://youtube.com/watch?v=${data.id}`,
      };
    }
  }

  return null;
}

/* ===============================
   Twitch検索（トークン再利用）
=================================*/
async function searchTwitch(channelName, targetDate) {

  const userRes = await axios.get(
    "https://api.twitch.tv/helix/users",
    {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${twitchToken}`,
      },
      params: { login: channelName },
    }
  );

  if (!userRes.data.data.length) return null;

  const user = userRes.data.data[0];

  const videosRes = await axios.get(
    "https://api.twitch.tv/helix/videos",
    {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${twitchToken}`,
      },
      params: { user_id: user.id, type: "archive", first: 50 },
    }
  );

  for (const v of videosRes.data.data) {
    const start = dayjs.utc(v.created_at);
    const durationSec = parseDuration(v.duration);
    const end = start.add(durationSec, "second");

    if (
      (targetDate.isAfter(start) || targetDate.isSame(start)) &&
      (targetDate.isBefore(end) || targetDate.isSame(end))
    ) {
      return {
        title: v.title,
        channelName: user.display_name,
        channelIcon: user.profile_image_url,
        channelUrl: `https://twitch.tv/${user.login}`,
        start: start.local().format("YY/MM/DD HH:mm"),
        end: end.local().format("YY/MM/DD HH:mm"),
        url: v.url,
      };
    }
  }

  return null;
}

/* ===============================
   Twitchトークン取得
=================================*/
async function getTwitchToken() {
  const res = await axios.post(
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
  return res.data.access_token;
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

client.login(process.env.DISCORD_TOKEN);