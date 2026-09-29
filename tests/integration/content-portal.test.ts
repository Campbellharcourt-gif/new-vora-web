import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "~/.server/lib/errors";
import { newId } from "~/.server/lib/ids";
import {
  canViewEngagement,
  listClientEngagements,
  listEngagementFiles,
} from "~/.server/services/client-portal";
import {
  getPublishedPage,
  getPublishedProject,
  listOpenRoles,
  listPublishedProjects,
  listVisibleSocialLinks,
} from "~/.server/services/published-content";
import { actorFor, createUser, db, makeCtx, schema } from "../support/helpers";

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe("public content reads published snapshots only", () => {
  it("never exposes working-copy drafts, even for published entries", async () => {
    const now = Date.now();
    const project = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.slug, "sail-gaming"))
      .get();
    if (!project) throw new Error("seed missing");
    const versionId = newId("version", now);
    await db.insert(schema.contentVersions).values({
      id: versionId,
      entityType: "project",
      entityId: project.id,
      version: 1,
      kind: "published",
      snapshot: {
        slug: "sail-gaming",
        title: "SAIL Gaming",
        summary: project.summary,
        category: "Esports",
        clientName: "SAIL Gaming",
      },
      createdAt: now,
    });
    await db
      .update(schema.projects)
      .set({ status: "published", publishedVersionId: versionId, publishedAt: now })
      .where(eq(schema.projects.id, project.id));
    // An editor starts changing the working copy after publishing.
    await db
      .update(schema.projects)
      .set({
        title: "UNREVIEWED DRAFT TITLE",
        summary: "unreviewed draft summary",
        hasUnpublishedChanges: true,
      })
      .where(eq(schema.projects.id, project.id));

    const ctx = makeCtx();
    const list = await listPublishedProjects(ctx);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      slug: "sail-gaming",
      title: "SAIL Gaming",
      summary: project.summary,
    });
    expect(JSON.stringify(list)).not.toContain("UNREVIEWED");
    expect((await getPublishedProject(ctx, "sail-gaming"))?.title).toBe("SAIL Gaming");
    expect(await getPublishedProject(ctx, "eon-clothing")).toBeNull(); // still a draft
    expect(await getPublishedProject(ctx, "../../etc/passwd")).toBeNull();
    expect(await getPublishedPage(ctx, "our-story")).toBeNull(); // seeded as draft

    await db
      .update(schema.projects)
      .set({ status: "archived" })
      .where(eq(schema.projects.id, project.id));
    expect(await listPublishedProjects(ctx)).toEqual([]);
  });

  it("lists open roles until their closing date", async () => {
    const now = Date.now();
    const roles = await db.select().from(schema.jobRoles).all();
    const [open, closed] = roles;
    if (!open || !closed) throw new Error("seed missing");
    for (const [role, closesAt] of [
      [open, now + 86_400_000],
      [closed, now - 1000],
    ] as const) {
      const versionId = newId("version", now);
      await db.insert(schema.contentVersions).values({
        id: versionId,
        entityType: "job_role",
        entityId: role.id,
        version: 1,
        kind: "published",
        snapshot: { slug: role.slug, title: role.title },
        createdAt: now,
      });
      await db
        .update(schema.jobRoles)
        .set({ status: "open", publishedVersionId: versionId, closesAt })
        .where(eq(schema.jobRoles.id, role.id));
    }
    const listed = await listOpenRoles(makeCtx());
    expect(listed.map((r) => r.slug)).toEqual([open.slug]);
  });

  it("returns only visible social links for a placement", async () => {
    const links = await listVisibleSocialLinks(makeCtx(), "footer");
    expect(links.map((l) => l.platform)).toEqual(["x", "discord"]);
    await db
      .update(schema.socialLinks)
      .set({ isVisible: false })
      .where(eq(schema.socialLinks.platform, "discord"));
    expect((await listVisibleSocialLinks(makeCtx(), "footer")).map((l) => l.platform)).toEqual([
      "x",
    ]);
  });
});

describe("client portal isolation", () => {
  const ids = {
    orgA: "",
    orgB: "",
    engA: "",
    engB: "",
    clientA: "",
    clientB: "",
    fileShared: "",
    fileInternal: "",
  };

  beforeAll(async () => {
    const now = Date.now();
    ids.orgA = newId("clientOrg", now);
    ids.orgB = newId("clientOrg", now);
    await db.insert(schema.clientOrgs).values([
      { id: ids.orgA, name: "Org A", slug: "org-a", createdAt: now, updatedAt: now },
      { id: ids.orgB, name: "Org B", slug: "org-b", createdAt: now, updatedAt: now },
    ]);
    ids.clientA = (await createUser({ roles: ["client"] })).id;
    ids.clientB = (await createUser({ roles: ["client"] })).id;
    await db.insert(schema.clientOrgMembers).values([
      { orgId: ids.orgA, userId: ids.clientA, createdAt: now },
      { orgId: ids.orgB, userId: ids.clientB, createdAt: now },
    ]);
    ids.engA = newId("engagement", now);
    ids.engB = newId("engagement", now);
    await db.insert(schema.engagements).values([
      { id: ids.engA, orgId: ids.orgA, name: "A: Website", createdAt: now, updatedAt: now },
      { id: ids.engB, orgId: ids.orgB, name: "B: Website", createdAt: now, updatedAt: now },
    ]);
    const media = (label: string) => ({
      id: newId("media", now),
      bucket: "private" as const,
      storageKey: `engagements/${label}-${now}`,
      kind: "document" as const,
      mimeType: "application/pdf",
      originalName: `${label}.pdf`,
      sizeBytes: 1024,
      status: "ready" as const,
      createdAt: now,
      updatedAt: now,
    });
    const shared = media("proposal");
    const internal = media("internal-notes");
    await db.insert(schema.mediaAssets).values([shared, internal]);
    ids.fileShared = newId("engagementFile", now);
    ids.fileInternal = newId("engagementFile", now);
    await db.insert(schema.engagementFiles).values([
      {
        id: ids.fileShared,
        engagementId: ids.engA,
        mediaId: shared.id,
        visibility: "client",
        label: "Proposal",
        createdAt: now,
      },
      {
        id: ids.fileInternal,
        engagementId: ids.engA,
        mediaId: internal.id,
        visibility: "internal",
        label: "Internal notes",
        createdAt: now,
      },
    ]);
  });

  it("shows clients only their own organisation's engagements", async () => {
    const clientA = await actorFor(ids.clientA);
    const list = await listClientEngagements(makeCtx(), clientA);
    expect(list.map((e) => e.id)).toEqual([ids.engA]);
  });

  it("answers another organisation's engagement with not found (no IDOR, no existence leak)", async () => {
    const clientA = await actorFor(ids.clientA);
    expect(await canViewEngagement(makeCtx(), clientA, ids.engB)).toBe(false);
    expect((await appError(listEngagementFiles(makeCtx(), clientA, ids.engB))).code).toBe(
      "not_found",
    );
    expect((await appError(listEngagementFiles(makeCtx(), clientA, "eng_doesnotexist"))).code).toBe(
      "not_found",
    );
  });

  it("never shows internal files to clients", async () => {
    const clientA = await actorFor(ids.clientA);
    const files = await listEngagementFiles(makeCtx(), clientA, ids.engA);
    expect(files.map((f) => f.id)).toEqual([ids.fileShared]);
  });

  it("limits Staff to assigned engagements while Managers see all, including internal files", async () => {
    const staff = await actorFor((await createUser({ roles: ["staff"] })).id);
    expect(await canViewEngagement(makeCtx(), staff, ids.engA)).toBe(false);
    await db
      .insert(schema.engagementStaff)
      .values({ engagementId: ids.engA, userId: staff.userId, createdAt: Date.now() });
    expect(await canViewEngagement(makeCtx(), staff, ids.engA)).toBe(true);
    expect(await canViewEngagement(makeCtx(), staff, ids.engB)).toBe(false);
    const manager = await actorFor((await createUser({ roles: ["manager"] })).id);
    expect(await canViewEngagement(makeCtx(), manager, ids.engB)).toBe(true);
    const files = await listEngagementFiles(makeCtx(), manager, ids.engA);
    expect(files.map((f) => f.id).sort()).toEqual([ids.fileShared, ids.fileInternal].sort());
  });

  it("keeps members and anonymous users out of the client portal", async () => {
    const member = await actorFor((await createUser({ roles: ["member"] })).id);
    expect((await appError(listClientEngagements(makeCtx(), member))).code).toBe("forbidden");
    expect((await appError(listClientEngagements(makeCtx(), null))).code).toBe("unauthenticated");
    expect(await canViewEngagement(makeCtx(), member, ids.engA)).toBe(false);
  });
});
