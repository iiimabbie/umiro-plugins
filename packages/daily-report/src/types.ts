export type ReportLevel = "normal" | "positive" | "warning" | "critical" | "muted" | "special";

export interface ReportItem {
  text: string;
  level?: ReportLevel;
  label?: string;
}

export interface ReportSection {
  title: string;
  items: ReportItem[];
}

export interface DailyReport {
  /** Stable local calendar date used to update, rather than duplicate, a same-day report. */
  date_key: string;
  date: string;
  headline: string;
  sections: ReportSection[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, any>) => Promise<string>;
}

export interface PluginToolRegistration {
  tool: ToolDefinition;
  group: string;
  exposure?: "native" | "match" | "index" | "on-demand";
  keywords?: string[];
  aliases?: string[];
  ownerOnly?: boolean;
}

export interface PluginConfigStore {
  readonly path: string;
  read<T extends Record<string, unknown>>(defaults: T): T;
  write(value: Record<string, unknown>): void;
  update<T extends Record<string, unknown>>(
    defaults: T,
    updater: (current: T) => Record<string, unknown>,
  ): T;
}

export interface PluginMessageTransport {
  sendText(input: { channelId: string; content: string }): Promise<{ messageId: string }>;
  editText(input: { channelId: string; messageId: string; content: string }): Promise<{ messageId: string; migrated: boolean }>;
}

export interface PluginRuntimeContext {
  ask(prompt: string, options?: { systemPrompt?: string; maxTurns?: number; model?: string }): Promise<{ text?: string }>;
  messages: PluginMessageTransport;
  config: PluginConfigStore;
}

export interface PluginScheduleRegistration {
  id: string;
  name?: string;
  schedule: string;
  timezone?: string;
  timeoutMs?: number;
  run(context: PluginRuntimeContext): Promise<void> | void;
}

export interface PluginSlashCommandRegistration {
  name: string;
  description: string;
  options?: Array<{
    name: string;
    description: string;
    type: "string" | "integer" | "boolean" | "channel";
    required?: boolean;
    choices?: Array<{ name: string; value: string | number }>;
  }>;
  ownerOnly?: boolean;
  ephemeral?: boolean;
  execute(
    args: Record<string, string | number | boolean | undefined>,
    context: { userId: string; channelId: string; guildId?: string; config: PluginConfigStore },
  ): Promise<string> | string;
}
