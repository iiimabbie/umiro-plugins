import { renderDailyReport, validateReport } from "./renderer.js";
import type {
  DailyReport,
  PluginConfigStore,
  PluginMessageTransport,
  PluginRuntimeContext,
  PluginScheduleRegistration,
  PluginSlashCommandRegistration,
  PluginToolRegistration,
} from "./types.js";

const DEFAULT_CONFIG = {
  channel_id: "",
  last_report: {
    date_key: "",
    message_id: "",
  },
  schedules: {
    "publish-daily-report": {
      enabled: false,
      schedule: "0 8 * * *",
      timezone: "Asia/Taipei",
    },
  },
};

type Publisher = {
  config: PluginConfigStore;
  messages: PluginMessageTransport;
};

let publisher: Publisher | null = null;

function parseTime(value: string): { hour: number; minute: number; display: string } {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value.trim());
  if (!match) throw new Error("時間請使用 24 小時制 HH:mm，例如 08:00 或 18:30");
  const [hour, minute] = value.trim().split(":").map(Number);
  return { hour, minute, display: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

function assertTimezone(value: string): string {
  const timezone = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error(`無效的 IANA 時區：${timezone}`);
  }
  return timezone;
}

function configuredTime(schedule: string): string {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length < 5 || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1])) return schedule;
  return `${fields[1].padStart(2, "0")}:${fields[0].padStart(2, "0")}`;
}

function configuredChannel(config: typeof DEFAULT_CONFIG): string {
  const channelId = config.channel_id.trim();
  if (!/^\d{17,20}$/.test(channelId)) throw new Error(`daily-report channel_id is invalid in ${publisher?.config.path ?? "plugin config"}`);
  return channelId;
}

function activePublisher(): Publisher {
  if (!publisher) throw new Error("daily-report plugin is not started");
  return publisher;
}

async function publishReport(value: unknown): Promise<string> {
  const report = validateReport(value);
  const active = activePublisher();
  const current = active.config.read(DEFAULT_CONFIG);
  const channelId = configuredChannel(current);
  const content = renderDailyReport(report);
  const previous = current.last_report;
  let messageId: string;
  let action: "published" | "updated" = "published";

  if (previous.date_key === report.date_key && /^\d{17,20}$/.test(previous.message_id)) {
    try {
      const edited = await active.messages.editText({ channelId, messageId: previous.message_id, content });
      messageId = edited.messageId;
      action = "updated";
    } catch {
      // The stored message may have been deleted or moved. Sending a fresh report is
      // safer than failing the daily workflow; the new message ID replaces stale state.
      const sent = await active.messages.sendText({ channelId, content });
      messageId = sent.messageId;
    }
  } else {
    const sent = await active.messages.sendText({ channelId, content });
    messageId = sent.messageId;
  }

  active.config.update(DEFAULT_CONFIG, stored => ({
    ...stored,
    last_report: {
      date_key: report.date_key,
      message_id: messageId,
    },
  }));
  return `Daily report ${action} (msg:${messageId})`;
}

const publishTool: PluginToolRegistration = {
  tool: {
    name: "daily_report_publish",
    description: "Publish structured daily report data directly to its configured Discord channel using the fixed daily-report layout. Use only for the daily report or an explicit request to republish it. This tool sends or updates the report itself; do not pass its rendered content to another Discord tool.",
    parameters: {
      type: "object",
      properties: {
        date_key: { type: "string", description: "Authoritative local calendar date in YYYY-MM-DD. Used to update the same day's report." },
        date: { type: "string", description: "Display date, including weekday, in Traditional Chinese." },
        headline: { type: "string", description: "One concise sentence containing the day's most important point." },
        sections: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short Traditional Chinese section title without an emoji; the renderer adds the matching section emoji." },
              items: {
                type: "array",
                maxItems: 8,
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string", description: "One concise factual item." },
                    level: {
                      type: "string",
                      enum: ["normal", "positive", "warning", "critical", "muted", "special"],
                      description: "Semantic visual level. Use critical only for urgent or action-required items.",
                    },
                    label: { type: "string", description: "Optional short visible label such as 注意、待處理、行程." },
                  },
                  required: ["text"],
                  additionalProperties: false,
                },
              },
            },
            required: ["title", "items"],
            additionalProperties: false,
          },
        },
      },
      required: ["date_key", "date", "headline", "sections"],
      additionalProperties: false,
    },
    async execute(args) {
      try {
        return await publishReport(args);
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  group: "private daily report",
  exposure: "match",
  keywords: ["日報", "daily report", "每日簡報"],
  aliases: ["publish daily report", "發布日報"],
  ownerOnly: true,
};

const dailySchedule: PluginScheduleRegistration = {
  id: "publish-daily-report",
  name: "Publish daily report",
  schedule: DEFAULT_CONFIG.schedules["publish-daily-report"].schedule,
  timezone: DEFAULT_CONFIG.schedules["publish-daily-report"].timezone,
  timeoutMs: 10 * 60 * 1000,
  async run({ ask, config }) {
    const current = config.read(DEFAULT_CONFIG);
    configuredChannel(current);
    await ask(
      [
        "Create and publish today's daily report.",
        "Use the authoritative current date and time from the runtime context. Never guess missing facts.",
        "Gather only the information needed for these sections, omitting empty sections:",
        "1. 今日天氣：weather for the owner's configured location, temperature range, rain timing, and one practical suggestion.",
        "2. 今日行程：today's calendar events in chronological order; include tomorrow only when preparation is needed today.",
        "3. 重要信件：first search mail with a result limit wide enough to cover a full day of traffic, not the default page size. Mail search results show the recipient address each message was delivered to, including forwarding hops; when several addresses appear, treat them as separate mailboxes of the same owner and make sure each one is represented before selecting. Include important mail from the recent 24 hours plus older mail still requiring action; exclude promotions and routine newsletters. If the search returns one or more qualifying messages, this section is mandatory: do not omit it because other sections are populated. Summarize sender/service, shortened subject, why it matters, and required action; never quote full private email bodies. Omit it only when a successful search finds no qualifying mail. If mail search fails, include this section with a muted source-unavailable item instead of silently omitting it.",
        "4. 提醒事項：active reminders, deadlines, unfinished owner tasks, or health/travel preparation that matters today.",
        "5. 近期行程：only important upcoming appointments, travel, birthdays, or deadlines with a useful countdown.",
        "6. 今日小結：one warm, practical judgment after considering the whole day.",
        "Use available calendar, mail, reminder, weather, memory, and other private tools as needed. Search the tool catalog when a capability is not directly exposed.",
        "Then call daily_report_publish with concise Traditional Chinese structured data. date_key must be the authoritative local YYYY-MM-DD date. Keep each section to the few items that actually matter. Use section titles without emoji; the renderer adds a matching emoji automatically.",
        "daily_report_publish sends or updates the configured Discord report itself. Do not call discord_send_message, discord_edit_message, or any other Discord publishing tool for the report.",
        "Do not send progress messages, previews, or report content to any other channel.",
        "If a required upstream source fails, say that source is temporarily unavailable in a muted report item instead of inventing data.",
      ].join("\n"),
      {
        systemPrompt: "You are running the trusted private daily report workflow. Be factual, concise, privacy-conscious, and action-oriented.",
        maxTurns: 18,
      },
    );
  },
};

const settingCommand: PluginSlashCommandRegistration = {
  name: "daily-report-setting",
  description: "查看或修改每日簡報的發送時間、頻道與時區",
  ownerOnly: true,
  ephemeral: true,
  options: [
    { name: "time", description: "每日發報時間，24 小時制 HH:mm", type: "string" },
    { name: "channel", description: "要發送每日簡報的 Discord 頻道或討論串", type: "channel" },
    { name: "timezone", description: "IANA 時區，例如 Asia/Taipei", type: "string" },
    { name: "enabled", description: "啟用或停用每日自動發報", type: "boolean" },
  ],
  execute(args, { config }) {
    const requestedTime = typeof args.time === "string" && args.time.trim() ? parseTime(args.time) : undefined;
    const requestedChannel = typeof args.channel === "string" && args.channel.trim() ? args.channel.trim() : undefined;
    const requestedTimezone = typeof args.timezone === "string" && args.timezone.trim()
      ? assertTimezone(args.timezone)
      : undefined;
    const requestedEnabled = typeof args.enabled === "boolean" ? args.enabled : undefined;

    if (!requestedTime && !requestedChannel && !requestedTimezone && requestedEnabled === undefined) {
      const current = config.read(DEFAULT_CONFIG);
      const job = current.schedules["publish-daily-report"];
      return [
        "**每日簡報目前設定**",
        `- 狀態：${job.enabled ? "已啟用" : "未啟用"}`,
        `- 時間：\`${configuredTime(job.schedule)}\``,
        `- 時區：\`${job.timezone}\``,
        `- 頻道：<#${current.channel_id}>`,
        `- 設定檔：\`${config.path}\``,
      ].join("\n");
    }

    const saved = config.update(DEFAULT_CONFIG, current => {
      const job = current.schedules["publish-daily-report"];
      return {
        ...current,
        ...(requestedChannel ? { channel_id: requestedChannel } : {}),
        schedules: {
          ...current.schedules,
          "publish-daily-report": {
            ...job,
            enabled: requestedEnabled ?? (job.enabled || Boolean(requestedTime || requestedChannel || requestedTimezone)),
            ...(requestedTime ? { schedule: `${requestedTime.minute} ${requestedTime.hour} * * *` } : {}),
            ...(requestedTimezone ? { timezone: requestedTimezone } : {}),
          },
        },
      };
    });
    const job = saved.schedules["publish-daily-report"];
    return [
      "**每日簡報設定已儲存**",
      `- 狀態：${job.enabled ? "已啟用" : "已停用"}`,
      `- 時間：\`${configuredTime(job.schedule)}\``,
      `- 時區：\`${job.timezone}\``,
      `- 頻道：<#${saved.channel_id}>`,
      "排程時間或時區會在執行 `/restart` 後套用。",
    ].join("\n");
  },
};

export default {
  manifest: {
    name: "daily-report",
    start(context: PluginRuntimeContext) {
      context.config.update(DEFAULT_CONFIG, current => current);
      publisher = { config: context.config, messages: context.messages };
    },
    stop() {
      publisher = null;
    },
  },
  tools: [publishTool],
  schedules: [dailySchedule],
  commands: [settingCommand],
};
