import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../auth/rbac";
import type { Actor } from "../auth/types";
import type { ServerContext } from "../context";
import { schema } from "../db/client";
import { errors } from "../lib/errors";
import { newId } from "../lib/ids";
import { writeAudit, diff } from "../observability/audit";
import { recordSecurityEvent } from "../observability/security-events";
import { revokeUserSessions } from "../auth/sessions";
import { setSetting, type SettingKey } from "./settings";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const text = (max: number) => z.string().trim().min(1).max(max);

const contentBody = z.array(z.record(z.string(), z.unknown())).max(1000);

function parseBody(value: unknown) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { throw errors.validation({ body: "Body must be valid JSON." }); }
}

async function nextVersion(ctx: ServerContext, entityType: "project"|"service"|"page", entityId: string) {
  const row = await ctx.db.select({ n: schema.contentVersions.version })
    .from(schema.contentVersions)
    .where(and(eq(schema.contentVersions.entityType, entityType), eq(schema.contentVersions.entityId, entityId)))
    .orderBy(desc(schema.contentVersions.version)).limit(1).get();
  return (row?.n ?? 0) + 1;
}

async function publishVersion(
  ctx: ServerContext, actor: Actor, entityType: "project"|"service"|"page", entityId: string, snapshot: Record<string, unknown>
) {
  const version = await nextVersion(ctx, entityType, entityId);
  const now = ctx.clock.now();
  const versionId = newId("version", now);
  await ctx.db.insert(schema.contentVersions).values({
    id: versionId, entityType, entityId, version, kind: "published", snapshot, schemaVersion: 1,
    note: "Published from admin workspace", createdBy: actor.userId, createdAt: now,
  });
  const table = entityType === "project" ? schema.projects : entityType === "service" ? schema.services : schema.pages;
  await ctx.db.update(table).set({ status: "published", publishedVersionId: versionId, publishedAt: now, hasUnpublishedChanges: false, updatedBy: actor.userId, updatedAt: now } as never)
    .where(eq(table.id, entityId)).run();
  await writeAudit(ctx, actor, {
    action: `content.${entityType}.publish`, targetType: entityType, targetId: entityId,
    summary: `Published ${entityType}`, changes: { version },
  });
}

export async function createProject(ctx: ServerContext, actorInput: Actor | null, input: Record<string, unknown>) {
  const actor = await authorize(ctx, actorInput, "projects.create");
  const parsed = z.object({
    slug, title: text(160), category: z.string().trim().max(120).nullable().optional(),
    summary: z.string().trim().max(500).nullable().optional(), year: z.coerce.number().int().min(1990).max(2100).nullable().optional(),
    clientName: z.string().trim().max(160).nullable().optional(), externalUrl: z.string().url().nullable().optional(),
    body: z.preprocess(parseBody, contentBody).default([]),
  }).safeParse(input);
  if (!parsed.success) throw errors.validation({ form: parsed.error.issues[0]?.message ?? "Invalid project." });
  const now=ctx.clock.now(), id=newId("project",now), v=parsed.data;
  try {
    await ctx.db.insert(schema.projects).values({
      id, slug:v.slug, title:v.title, category:v.category ?? null, summary:v.summary ?? null, year:v.year ?? null,
      clientName:v.clientName ?? null, externalUrl:v.externalUrl ?? null, body:v.body, credits:[], status:"draft",
      isFeatured:false, sortOrder:0, hasUnpublishedChanges:true, createdBy:actor.userId, updatedBy:actor.userId, createdAt:now, updatedAt:now,
    });
  } catch { throw errors.validation({ slug: "That project slug is already in use." }); }
  await writeAudit(ctx,actor,{action:"projects.create",targetType:"project",targetId:id,summary:`Created project ${v.title}`});
  return id;
}

export async function updateProject(ctx: ServerContext, actorInput: Actor | null, id: string, input: Record<string, unknown>) {
  const actor=await authorize(ctx,actorInput,"projects.edit");
  const current=await ctx.db.select().from(schema.projects).where(eq(schema.projects.id,id)).get();
  if(!current || current.archivedAt) throw errors.notFound();
  const parsed=z.object({
    slug,title:text(160),category:z.string().trim().max(120).nullable().optional(),summary:z.string().trim().max(500).nullable().optional(),
    year:z.coerce.number().int().min(1990).max(2100).nullable().optional(),clientName:z.string().trim().max(160).nullable().optional(),
    externalUrl:z.string().url().nullable().optional(),body:z.preprocess(parseBody,contentBody).default([]),
    isFeatured:z.boolean().optional(),
  }).safeParse(input);
  if(!parsed.success) throw errors.validation({form:parsed.error.issues[0]?.message??"Invalid project."});
  const v=parsed.data, now=ctx.clock.now();
  await ctx.db.update(schema.projects).set({...v,hasUnpublishedChanges:true,updatedBy:actor.userId,updatedAt:now}).where(eq(schema.projects.id,id)).run();
  await writeAudit(ctx,actor,{action:"projects.update",targetType:"project",targetId:id,summary:`Updated project ${v.title}`,changes:diff(current as never,v as never,["slug","title","category","summary","year","clientName","externalUrl","isFeatured"])});
}

export async function publishProject(ctx: ServerContext, actorInput: Actor | null, id:string) {
  const actor=await authorize(ctx,actorInput,"projects.publish");
  const row=await ctx.db.select().from(schema.projects).where(eq(schema.projects.id,id)).get(); if(!row) throw errors.notFound();
  await publishVersion(ctx,actor,"project",id,{...row, body:row.body, credits:row.credits, publishedVersionId:undefined});
}

export async function archiveProject(ctx:ServerContext,actorInput:Actor|null,id:string){
  const actor=await authorize(ctx,actorInput,"projects.publish"); const now=ctx.clock.now();
  await ctx.db.update(schema.projects).set({archivedAt:now,status:"archived",updatedBy:actor.userId,updatedAt:now}).where(eq(schema.projects.id,id)).run();
  await writeAudit(ctx,actor,{action:"projects.archive",targetType:"project",targetId:id,summary:"Archived project"});
}

export async function createService(ctx:ServerContext,actorInput:Actor|null,input:Record<string,unknown>){
  const actor=await authorize(ctx,actorInput,"services.edit");
  const v=z.object({slug,title:text(120),summary:z.string().trim().max(500).nullable().optional(),deliveryModel:z.enum(["vora","partner","joint"]),body:z.preprocess(parseBody,contentBody).default([])}).safeParse(input);
  if(!v.success) throw errors.validation({form:v.error.issues[0]?.message??"Invalid service."});
  const now=ctx.clock.now(),id=newId("service",now),d=v.data;
  try{await ctx.db.insert(schema.services).values({id,slug:d.slug,name:d.title,summary:d.summary??null,deliveryModel:d.deliveryModel,body:d.body,status:"draft",sortOrder:0,hasUnpublishedChanges:true,createdBy:actor.userId,updatedBy:actor.userId,createdAt:now,updatedAt:now});}
  catch{throw errors.validation({slug:"That service slug is already in use."});}
  await writeAudit(ctx,actor,{action:"services.create",targetType:"service",targetId:id,summary:`Created service ${d.title}`}); return id;
}

export async function updateService(ctx:ServerContext,actorInput:Actor|null,id:string,input:Record<string,unknown>){
  const actor=await authorize(ctx,actorInput,"services.edit"); const current=await ctx.db.select().from(schema.services).where(eq(schema.services.id,id)).get(); if(!current||current.archivedAt)throw errors.notFound();
  const v=z.object({slug,title:text(120),summary:z.string().trim().max(500).nullable().optional(),deliveryModel:z.enum(["vora","partner","joint"]),body:z.preprocess(parseBody,contentBody).default([])}).safeParse(input);
  if(!v.success)throw errors.validation({form:v.error.issues[0]?.message??"Invalid service."}); const d=v.data,now=ctx.clock.now();
  await ctx.db.update(schema.services).set({slug:d.slug,name:d.title,summary:d.summary??null,deliveryModel:d.deliveryModel,body:d.body,hasUnpublishedChanges:true,updatedBy:actor.userId,updatedAt:now}).where(eq(schema.services.id,id)).run();
  await writeAudit(ctx,actor,{action:"services.update",targetType:"service",targetId:id,summary:`Updated service ${d.title}`});
}

export async function publishService(ctx:ServerContext,actorInput:Actor|null,id:string){
  const actor=await authorize(ctx,actorInput,"services.publish"); const row=await ctx.db.select().from(schema.services).where(eq(schema.services.id,id)).get();if(!row)throw errors.notFound();
  await publishVersion(ctx,actor,"service",id,{...row,publishedVersionId:undefined});
}

export async function createClient(ctx:ServerContext,actorInput:Actor|null,input:Record<string,unknown>){
  const actor=await authorize(ctx,actorInput,"clients.manage");
  const v=z.object({name:text(160),slug,websiteUrl:z.string().url().nullable().optional()}).safeParse(input);if(!v.success)throw errors.validation({form:v.error.issues[0]?.message??"Invalid client."});
  const now=ctx.clock.now(),id=newId("clientOrg",now),d=v.data;
  try{await ctx.db.insert(schema.clientOrgs).values({id,name:d.name,slug:d.slug,websiteUrl:d.websiteUrl??null,status:"active",createdAt:now,updatedAt:now});}
  catch{throw errors.validation({slug:"That client slug is already in use."});}
  await writeAudit(ctx,actor,{action:"clients.create",targetType:"client_org",targetId:id,summary:`Created client ${d.name}`});return id;
}

export async function updateClient(ctx:ServerContext,actorInput:Actor|null,id:string,input:Record<string,unknown>){
  const actor=await authorize(ctx,actorInput,"clients.manage"); const current=await ctx.db.select().from(schema.clientOrgs).where(eq(schema.clientOrgs.id,id)).get();if(!current)throw errors.notFound();
  const v=z.object({name:text(160),slug,websiteUrl:z.string().url().nullable().optional(),status:z.enum(["active","archived"])}).safeParse(input);if(!v.success)throw errors.validation({form:v.error.issues[0]?.message??"Invalid client."});
  const now=ctx.clock.now();await ctx.db.update(schema.clientOrgs).set({...v.data,updatedAt:now}).where(eq(schema.clientOrgs.id,id)).run();
  await writeAudit(ctx,actor,{action:"clients.update",targetType:"client_org",targetId:id,summary:`Updated client ${v.data.name}`});
}

export async function createEngagement(ctx:ServerContext,actorInput:Actor|null,input:Record<string,unknown>){
  const actor=await authorize(ctx,actorInput,"engagements.manage");
  const v=z.object({orgId:text(40),name:text(160),summary:z.string().trim().max(1000).nullable().optional(),startDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),targetDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),status:z.enum(["planning","in_progress","review","delivered","on_hold","closed"])}).safeParse(input);
  if(!v.success)throw errors.validation({form:v.error.issues[0]?.message??"Invalid engagement."});const now=ctx.clock.now(),id=newId("engagement",now),d=v.data;
  const org=await ctx.db.select({id:schema.clientOrgs.id}).from(schema.clientOrgs).where(eq(schema.clientOrgs.id,d.orgId)).get();if(!org)throw errors.validation({orgId:"Client organisation not found."});
  await ctx.db.insert(schema.engagements).values({id,orgId:d.orgId,name:d.name,summary:d.summary??null,startDate:d.startDate??null,targetDate:d.targetDate??null,status:d.status,createdBy:actor.userId,createdAt:now,updatedAt:now});
  await writeAudit(ctx,actor,{action:"engagements.create",targetType:"engagement",targetId:id,summary:`Created engagement ${d.name}`});return id;
}

export async function updateEngagement(ctx:ServerContext,actorInput:Actor|null,id:string,input:Record<string,unknown>){
  const actor=await authorize(ctx,actorInput,"engagements.manage"); const current=await ctx.db.select().from(schema.engagements).where(eq(schema.engagements.id,id)).get();if(!current)throw errors.notFound();
  const v=z.object({name:text(160),summary:z.string().trim().max(1000).nullable().optional(),startDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),targetDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),status:z.enum(["planning","in_progress","review","delivered","on_hold","closed"])}).safeParse(input);if(!v.success)throw errors.validation({form:v.error.issues[0]?.message??"Invalid engagement."});
  const now=ctx.clock.now();await ctx.db.update(schema.engagements).set({...v.data,updatedAt:now}).where(eq(schema.engagements.id,id)).run();await writeAudit(ctx,actor,{action:"engagements.update",targetType:"engagement",targetId:id,summary:`Updated engagement ${v.data.name}`});
}

export async function updateAdminSetting(ctx:ServerContext,actorInput:Actor|null,key:string,value:unknown){
  if(!(key in ({} as Record<SettingKey,unknown>))) { /* runtime validation is performed below */ }
  return setSetting(ctx,actorInput,key as SettingKey,value);
}

export async function revokeOtherSessions(ctx:ServerContext,actorInput:Actor|null,userId:string){
  const actor=await authorize(ctx,actorInput,"security.manage"); if(actor.userId===userId) throw errors.validation({userId:"Use account security to revoke your own sessions."});
  const count=await revokeUserSessions(ctx,userId,"admin_security_action",actor.session.id);
  await recordSecurityEvent(ctx,{type:"auth.sessions.revoked",severity:"medium",userId:actor.userId,details:{targetUserId:userId,count}});
  await writeAudit(ctx,actor,{action:"security.sessions.revoke",targetType:"user",targetId:userId,summary:`Revoked sessions for user ${userId}`,changes:{count}});
  return count;
}

export async function listAdminEngagements(ctx:ServerContext,actorInput:Actor|null){
  await authorize(ctx,actorInput,"engagements.view");
  return ctx.db.select({id:schema.engagements.id,name:schema.engagements.name,status:schema.engagements.status,orgName:schema.clientOrgs.name,orgId:schema.engagements.orgId,startDate:schema.engagements.startDate,targetDate:schema.engagements.targetDate,updatedAt:schema.engagements.updatedAt})
    .from(schema.engagements).innerJoin(schema.clientOrgs,eq(schema.clientOrgs.id,schema.engagements.orgId)).orderBy(desc(schema.engagements.updatedAt)).all();
}
