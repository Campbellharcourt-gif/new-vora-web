import { AI_USAGE_STATUSES } from "@shared/enums";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { inList, isBool } from "./_helpers";
import { users } from "./identity";

export const AI_CHANNELS = ["public", "admin"] as const;

export const aiPrompts = sqliteTable(
  "ai_prompts",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("ai_prompts_key_version_uq").on(t.key, t.version),
    check("ai_prompts_active_ck", isBool(t.isActive)),
    check("ai_prompts_len_ck", sql`length(${t.content}) between 1 and 20000`),
  ],
);

export const aiConversations = sqliteTable(
  "ai_conversations",
  {
    id: text("id").primaryKey(),
    channel: text("channel", { enum: AI_CHANNELS }).notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    visitorHash: text("visitor_hash"),
    status: text("status", { enum: ["active", "closed", "flagged"] })
      .notNull()
      .default("active"),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    lastMessageAt: integer("last_message_at").notNull(),
    retentionUntil: integer("retention_until").notNull(),
  },
  (t) => [
    index("ai_conversations_user_idx").on(t.userId, t.lastMessageAt),
    index("ai_conversations_retention_idx").on(t.retentionUntil),
    check("ai_conversations_channel_ck", inList(t.channel, AI_CHANNELS)),
    check("ai_conversations_status_ck", inList(t.status, ["active", "closed", "flagged"])),
  ],
);

export const aiMessages = sqliteTable(
  "ai_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    flagged: integer("flagged", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("ai_messages_conversation_idx").on(t.conversationId, t.createdAt),
    check("ai_messages_role_ck", inList(t.role, ["user", "assistant"])),
    check("ai_messages_flagged_ck", isBool(t.flagged)),
  ],
);

export const aiUsage = sqliteTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id"),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    channel: text("channel", { enum: AI_CHANNELS }).notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: text("status", { enum: AI_USAGE_STATUSES }).notNull(),
    errorCode: text("error_code"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costMicroUsd: integer("cost_micro_usd"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("ai_usage_created_idx").on(t.createdAt),
    index("ai_usage_user_idx").on(t.userId, t.createdAt),
    check("ai_usage_channel_ck", inList(t.channel, AI_CHANNELS)),
    check("ai_usage_status_ck", inList(t.status, AI_USAGE_STATUSES)),
  ],
);
