import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "~/.server/lib/errors";
import {
  createContent,
  getContent,
  listContent,
  publishContent,
  restoreVersion,
  saveContent,
  setArchived,
  unpublishContent,
} from "~/.server/services/content-admin";
import { getPublishedPage, getPublishedProject } from "~/.server/services/published-content";
import { getSetting, setSetting } from "~/.server/services/settings";
import { saveSocialLink } from "~/.server/services/social-links";
import { actorFor, createUser, db, makeCtx, schema } from "../support/helpers";

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

type Actor = Awaited<ReturnType<typeof actorFor>>;
let manager: Actor;
let staff: Actor;
let client: Actor;
let admin: Actor;

beforeAll(async () => {
  manager = await actorFor((await createUser({ roles: ["manager"] })).id);
  staff = await actorFor((await createUser({ roles: ["staff"] })).id);
  client = await actorFor((await createUser({ roles: ["client"] })).id);
  admin = await actorFor((await createUser({ roles: ["admin"] })).id);
});

const projectInput = (title: string, slug: string, body = "") => ({
  title,
  slug,
  summary: "A summary.",
  body,
});

describe("CMS — drafts, publishing and versions", () => {
  it("staff draft projects; only roles with publish permission publish them", async () => {
    const id = await createContent(
      makeCtx(),
      staff,
      "project",
      projectInput("Staff draft", "staff-draft"),
    );
    await saveContent(
      makeCtx(),
      staff,
      "project",
      id,
      projectInput("Staff draft v2", "staff-draft"),
    );
    expect((await appError(publishContent(makeCtx(), staff, "project", id))).code).toBe(
      "forbidden",
    );
    expect(await getPublishedProject(makeCtx(), "staff-draft")).toBeNull();
    await publishContent(makeCtx(), manager, "project", id);
    expect((await getPublishedProject(makeCtx(), "staff-draft"))?.title).toBe("Staff draft v2");
  });

  it("the public site keeps the published snapshot while a new draft is edited", async () => {
    const ctx = makeCtx();
    const id = await createContent(
      ctx,
      manager,
      "project",
      projectInput("Northwind", "northwind", "## Brief\n\nFirst."),
    );
    await publishContent(makeCtx(), manager, "project", id, "Launch");
    await saveContent(
      makeCtx(),
      manager,
      "project",
      id,
      projectInput("Northwind (draft)", "northwind", "Unreviewed."),
    );
    const live = await getPublishedProject(makeCtx(), "northwind");
    expect(live?.title).toBe("Northwind");
    expect(live?.body).toEqual([
      { type: "heading", level: 2, content: [{ text: "Brief" }] },
      { type: "paragraph", content: [{ text: "First." }] },
    ]);
    // The snapshot never carries workflow fields.
    for (const key of [
      "status",
      "publishedVersionId",
      "createdBy",
      "updatedAt",
      "hasUnpublishedChanges",
    ]) {
      expect(live).not.toHaveProperty(key);
    }
    const item = await getContent(makeCtx(), manager, "project", id);
    expect(item.row.hasUnpublishedChanges).toBe(true);
    expect(item.versions.map((v) => v.kind)).toEqual(["draft", "published", "draft"]);
    expect(item.versions.find((v) => v.kind === "published")?.isLive).toBe(true);
  });

  it("restores an earlier version as a draft, then publishing makes it live", async () => {
    const id = await createContent(
      makeCtx(),
      manager,
      "project",
      projectInput("Version one", "versions"),
    );
    await publishContent(makeCtx(), manager, "project", id);
    await saveContent(makeCtx(), manager, "project", id, projectInput("Version two", "versions"));
    await publishContent(makeCtx(), manager, "project", id);
    expect((await getPublishedProject(makeCtx(), "versions"))?.title).toBe("Version two");

    const { versions } = await getContent(makeCtx(), manager, "project", id);
    const first = versions.find((v) => v.kind === "published" && !v.isLive);
    if (!first) throw new Error("expected the first published version");
    await restoreVersion(makeCtx(), manager, "project", id, first.id);
    // Restoring changes the working copy only.
    expect((await getPublishedProject(makeCtx(), "versions"))?.title).toBe("Version two");
    const restored = await getContent(makeCtx(), manager, "project", id);
    expect(restored.row.title).toBe("Version one");
    expect(restored.versions[0]?.kind).toBe("restored");
    await publishContent(makeCtx(), manager, "project", id);
    expect((await getPublishedProject(makeCtx(), "versions"))?.title).toBe("Version one");

    const audit = await db
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, id))
      .all();
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "content.project.create",
        "content.project.update",
        "content.project.publish",
        "content.project.restore",
      ]),
    );
  });

  it("a version from another item can't be restored onto this one", async () => {
    const a = await createContent(makeCtx(), manager, "project", projectInput("A", "item-a"));
    const b = await createContent(makeCtx(), manager, "project", projectInput("B", "item-b"));
    const { versions } = await getContent(makeCtx(), manager, "project", a);
    const error = await appError(
      restoreVersion(makeCtx(), manager, "project", b, versions[0]?.id ?? ""),
    );
    expect(error.code).toBe("not_found");
  });

  it("unpublish and archive take items off the site; published versions are kept", async () => {
    const id = await createContent(
      makeCtx(),
      manager,
      "project",
      projectInput("Temporary", "temporary"),
    );
    await publishContent(makeCtx(), manager, "project", id);
    await unpublishContent(makeCtx(), manager, "project", id);
    expect(await getPublishedProject(makeCtx(), "temporary")).toBeNull();
    await setArchived(makeCtx(), manager, "project", id, true);
    expect((await listContent(makeCtx(), manager, "project")).some((p) => p.id === id)).toBe(false);
    expect(
      (await listContent(makeCtx(), manager, "project", { archived: true })).some(
        (p) => p.id === id,
      ),
    ).toBe(true);
    const kept = await db
      .select()
      .from(schema.contentVersions)
      .where(
        and(eq(schema.contentVersions.entityId, id), eq(schema.contentVersions.kind, "published")),
      )
      .all();
    expect(kept).toHaveLength(1);
    expect(
      (
        await appError(
          saveContent(makeCtx(), manager, "project", id, projectInput("x", "temporary")),
        )
      ).code,
    ).toBe("conflict");
  });

  it("validates input: addresses, links, unique slugs and the content format", async () => {
    const bad = await appError(
      createContent(makeCtx(), manager, "project", {
        title: "",
        slug: "Not A Slug",
        externalUrl: "javascript:alert(1)",
      }),
    );
    expect(bad.code).toBe("validation_failed");
    expect(Object.keys(bad.fields ?? {})).toEqual(
      expect.arrayContaining(["title", "slug", "externalUrl"]),
    );
    await createContent(makeCtx(), manager, "project", projectInput("Unique", "unique-slug"));
    const dup = await appError(
      createContent(makeCtx(), manager, "project", projectInput("Again", "unique-slug")),
    );
    expect(dup.fields?.slug).toMatch(/already used/);
    const link = await appError(
      createContent(
        makeCtx(),
        manager,
        "project",
        projectInput("Links", "links", "[click](javascript:alert(1))"),
      ),
    );
    expect(link.fields?.body).toBeTruthy();
  });

  it("stores markup as text, never HTML", async () => {
    const id = await createContent(
      makeCtx(),
      manager,
      "project",
      projectInput("XSS", "xss", "<img src=x onerror=alert(1)>"),
    );
    const { row } = await getContent(makeCtx(), manager, "project", id);
    expect(row.body).toEqual([
      { type: "paragraph", content: [{ text: "<img src=x onerror=alert(1)>" }] },
    ]);
  });

  it("pages are edited and published, never created; their keys can't change", async () => {
    expect((await appError(createContent(makeCtx(), admin, "page", { title: "New" }))).code).toBe(
      "forbidden",
    );
    const terms = await db.select().from(schema.pages).where(eq(schema.pages.key, "terms")).get();
    if (!terms) throw new Error("seed missing");
    await saveContent(makeCtx(), manager, "page", terms.id, {
      title: "Terms & Conditions",
      key: "hijack",
      body: "## 1. About",
    });
    await publishContent(makeCtx(), manager, "page", terms.id);
    const page = await getPublishedPage(makeCtx(), "terms");
    expect(page?.title).toBe("Terms & Conditions");
    expect(page?.key).toBe("terms");
  });

  it("clients and members can't read or change content", async () => {
    expect((await appError(listContent(makeCtx(), client, "project"))).code).toBe("forbidden");
    const id = (await listContent(makeCtx(), manager, "project"))[0]?.id ?? "";
    expect(
      (await appError(saveContent(makeCtx(), client, "project", id, projectInput("x", "x")))).code,
    ).toBe("forbidden");
  });
});

describe("CMS — site copy and social links", () => {
  it("home page lines and the announcement need publish rights and are validated", async () => {
    expect(
      (
        await appError(
          setSetting(makeCtx(), staff, "home.copy", { approachLines: ["x"], invitationLine: null }),
        )
      ).code,
    ).toBe("forbidden");
    await setSetting(makeCtx(), manager, "home.copy", {
      approachLines: ["Built with *care.*"],
      invitationLine: "Let's talk.",
    });
    expect((await getSetting(makeCtx(), "home.copy")).invitationLine).toBe("Let's talk.");
    const unsafe = await appError(
      setSetting(makeCtx(), manager, "site.announcement", {
        enabled: true,
        message: "Hello",
        linkLabel: "Go",
        linkHref: "javascript:alert(1)",
      }),
    );
    expect(unsafe.code).toBe("validation_failed");
    const backslash = await appError(
      setSetting(makeCtx(), manager, "site.announcement", {
        enabled: true,
        message: "Hello",
        linkLabel: "Go",
        linkHref: "/\\evil.example",
      }),
    );
    expect(backslash.code).toBe("validation_failed");
  });

  it("social links are https-only and need social.manage", async () => {
    expect(
      (
        await appError(
          saveSocialLink(makeCtx(), manager, null, {
            platform: "x",
            label: "X",
            url: "https://x.com/vora",
          }),
        )
      ).code,
    ).toBe("forbidden");
    const bad = await appError(
      saveSocialLink(makeCtx(), admin, null, {
        platform: "x",
        label: "X",
        url: "http://x.com/vora",
      }),
    );
    expect(bad.fields?.url).toBeTruthy();
    const id = await saveSocialLink(makeCtx(), admin, null, {
      platform: "x",
      label: "X",
      url: "x.com/vora",
      isVisible: "on",
    });
    const row = await db
      .select()
      .from(schema.socialLinks)
      .where(eq(schema.socialLinks.id, id))
      .get();
    expect(row?.url).toBe("https://x.com/vora");
  });
});

describe("legal pages", () => {
  it("are named Terms & Conditions and Privacy Policy, and stay unpublished until approved", async () => {
    const rows = await db.select().from(schema.pages).all();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    expect(byKey.get("privacy")?.title).toBe("Privacy Policy");
    expect(byKey.get("privacy")?.publishedVersionId).toBeNull();
    expect(await getPublishedPage(makeCtx(), "privacy")).toBeNull();
  });
});
