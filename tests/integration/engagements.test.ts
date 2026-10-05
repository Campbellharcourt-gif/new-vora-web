import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "~/.server/lib/errors";
import {
  getClientEngagement,
  listClientEngagements,
  postClientMessage,
} from "~/.server/services/client-portal";
import {
  getClient,
  getEngagement,
  linkClientUser,
  listEngagements,
  openEngagementFile,
  postEngagementUpdate,
  saveClient,
  saveEngagement,
  saveMilestone,
  setEngagementStaff,
  setFileVisibility,
  uploadEngagementFile,
} from "~/.server/services/engagements";
import { cleanFileName, stripJpegMetadata, validateUpload } from "~/.server/services/files";
import { listNotifications } from "~/.server/services/notifications";
import { actorFor, call, createUser, db, makeCtx, schema, testEnv } from "../support/helpers";

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

type Actor = Awaited<ReturnType<typeof actorFor>>;

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const pdf = (name = "brief.pdf") => new File([PDF], name, { type: "application/pdf" });

let manager: Actor;
let assignedStaff: Actor;
let otherStaff: Actor;
let clientA: Actor;
let clientB: Actor;
let member: Actor;
let orgA: string;
let orgB: string;
let projectA: string;
let projectB: string;

beforeAll(async () => {
  manager = await actorFor((await createUser({ roles: ["manager"] })).id);
  assignedStaff = await actorFor((await createUser({ roles: ["staff"], name: "Sam Staff" })).id);
  otherStaff = await actorFor((await createUser({ roles: ["staff"] })).id);
  const a = await createUser({ roles: ["client"], name: "Alex Client" });
  const b = await createUser({ roles: ["client"], name: "Blair Client" });
  clientA = await actorFor(a.id);
  clientB = await actorFor(b.id);
  member = await actorFor((await createUser({ roles: ["member"] })).id);

  orgA = await saveClient(makeCtx(), manager, null, { name: "Alpha Co" });
  orgB = await saveClient(makeCtx(), manager, null, { name: "Beta Co" });
  await linkClientUser(makeCtx(), manager, orgA, { email: a.email });
  await linkClientUser(makeCtx(), manager, orgB, { email: b.email });
  projectA = await saveEngagement(makeCtx(), manager, null, {
    orgId: orgA,
    name: "Alpha website",
    status: "planning",
  });
  projectB = await saveEngagement(makeCtx(), manager, null, {
    orgId: orgB,
    name: "Beta brand",
    status: "planning",
  });
  await setEngagementStaff(makeCtx(), manager, projectA, [assignedStaff.userId]);
});

describe("client projects — data isolation", () => {
  it("each client sees only their own organisation's projects", async () => {
    const a = await listClientEngagements(makeCtx(), clientA);
    expect(a.map((e) => e.id)).toEqual([projectA]);
    const b = await listClientEngagements(makeCtx(), clientB);
    expect(b.map((e) => e.id)).toEqual([projectB]);
    expect((await appError(getClientEngagement(makeCtx(), clientA, projectB))).code).toBe(
      "not_found",
    );
    expect((await appError(postClientMessage(makeCtx(), clientA, projectB, "hi"))).code).toBe(
      "not_found",
    );
  });

  it("internal updates and files never reach the client; shared ones do", async () => {
    await postEngagementUpdate(makeCtx(), manager, projectA, {
      body: "Internal margin note",
      visibility: "internal",
    });
    await postEngagementUpdate(makeCtx(), manager, projectA, {
      body: "Kick-off booked",
      visibility: "client",
    });
    const internalFile = await uploadEngagementFile(makeCtx(), manager, projectA, {
      file: pdf("internal.pdf"),
      label: "Internal estimate",
      visibility: "internal",
    });
    const sharedFile = await uploadEngagementFile(makeCtx(), manager, projectA, {
      file: pdf("brief.pdf"),
      label: "Brief",
      visibility: "client",
    });
    const view = await getClientEngagement(makeCtx(), clientA, projectA);
    expect(view.updates.map((u) => u.body)).toEqual(["Kick-off booked"]);
    expect(view.files.map((f) => f.id)).toEqual([sharedFile]);
    expect(JSON.stringify(view)).not.toContain("Internal");

    // Downloads follow the same policy (404, never 403, so ids reveal nothing).
    expect((await openEngagementFile(makeCtx(), clientA, sharedFile)).name).toBe("brief.pdf");
    expect((await appError(openEngagementFile(makeCtx(), clientA, internalFile))).code).toBe(
      "not_found",
    );
    expect((await appError(openEngagementFile(makeCtx(), clientB, sharedFile))).code).toBe(
      "not_found",
    );
    expect((await appError(openEngagementFile(makeCtx(), member, sharedFile))).code).toBe(
      "not_found",
    );
    expect((await appError(openEngagementFile(makeCtx(), otherStaff, internalFile))).code).toBe(
      "not_found",
    );
    expect((await openEngagementFile(makeCtx(), assignedStaff, internalFile)).name).toBe(
      "internal.pdf",
    );
    expect((await appError(openEngagementFile(makeCtx(), null, sharedFile))).code).toBe(
      "unauthenticated",
    );

    // Sharing later works; un-sharing removes access again.
    await setFileVisibility(makeCtx(), manager, projectA, internalFile, "client");
    expect((await openEngagementFile(makeCtx(), clientA, internalFile)).name).toBe("internal.pdf");
    await setFileVisibility(makeCtx(), manager, projectA, internalFile, "internal");
    expect((await appError(openEngagementFile(makeCtx(), clientA, internalFile))).code).toBe(
      "not_found",
    );
  });

  it("the download endpoint serves attachments with nosniff, and 404s other clients", async () => {
    const fileId = await uploadEngagementFile(makeCtx(), manager, projectA, {
      file: pdf("report.pdf"),
      label: "Report",
      visibility: "client",
    });
    const ok = await call(`/api/v1/files/${fileId}`, { token: clientA.token });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(PDF);
    const denied = await call(`/api/v1/files/${fileId}`, { token: clientB.token });
    expect(denied.status).toBe(404);
    const anonymous = await call(`/api/v1/files/${fileId}`);
    expect(anonymous.status).toBe(401);
  });

  it("staff see and work on only the projects they're assigned to", async () => {
    expect((await listEngagements(makeCtx(), assignedStaff)).map((e) => e.id)).toEqual([projectA]);
    expect(await listEngagements(makeCtx(), otherStaff)).toEqual([]);
    expect((await appError(getEngagement(makeCtx(), otherStaff, projectA))).code).toBe("not_found");
    expect(
      (
        await appError(
          saveMilestone(makeCtx(), otherStaff, projectA, null, { title: "x", status: "upcoming" }),
        )
      ).code,
    ).toBe("not_found");
    await saveMilestone(makeCtx(), assignedStaff, projectA, null, {
      title: "Design review",
      status: "upcoming",
    });
    // Staff can't create projects or change the team.
    expect(
      (
        await appError(
          saveEngagement(makeCtx(), assignedStaff, null, {
            orgId: orgA,
            name: "x",
            status: "planning",
          }),
        )
      ).code,
    ).toBe("forbidden");
    expect((await appError(setEngagementStaff(makeCtx(), assignedStaff, projectA, []))).code).toBe(
      "forbidden",
    );
  });

  it("clients and members can't reach the admin side at all", async () => {
    for (const actor of [clientA, member]) {
      expect((await appError(listEngagements(makeCtx(), actor))).code).toBe("forbidden");
      expect((await appError(getClient(makeCtx(), actor, orgA))).code).toBe("forbidden");
      expect((await appError(getEngagement(makeCtx(), actor, projectA))).code).toBe("forbidden");
    }
  });

  it("only Client accounts can be linked to an organisation", async () => {
    const staffEmail =
      (await db.select().from(schema.users).where(eq(schema.users.id, otherStaff.userId)).get())
        ?.email ?? "";
    const error = await appError(linkClientUser(makeCtx(), manager, orgA, { email: staffEmail }));
    expect(error.fields?.email).toMatch(/No Client account/);
  });

  it("clients are notified of shared updates; assigned staff of client messages", async () => {
    await postEngagementUpdate(makeCtx(), manager, projectA, {
      body: "Designs ready",
      visibility: "client",
    });
    const forClient = await listNotifications(makeCtx(), clientA);
    expect(
      forClient.some(
        (n) => n.type === "engagement.update" && n.link === `/client/projects/${projectA}`,
      ),
    ).toBe(true);
    expect(
      (await listNotifications(makeCtx(), clientB)).some((n) => n.link?.includes(projectA)),
    ).toBe(false);
    await postClientMessage(makeCtx(), clientA, projectA, "Looks great");
    const forStaff = await listNotifications(makeCtx(), assignedStaff);
    expect(forStaff.some((n) => n.type === "engagement.client_message")).toBe(true);
  });
});

describe("uploads — validation", () => {
  it("decides the type from the bytes and refuses mismatches and active content", async () => {
    const html = new File(["<!doctype html><script>alert(1)</script>"], "page.html", {
      type: "text/html",
    });
    expect((await appError(validateUpload(html))).fields?.file).toMatch(/isn't accepted/);
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "logo.svg", {
      type: "image/svg+xml",
    });
    expect((await appError(validateUpload(svg))).code).toBe("validation_failed");
    const disguised = new File(["MZ\x90\x00 not really a pdf"], "invoice.pdf", {
      type: "application/pdf",
    });
    expect((await appError(validateUpload(disguised))).fields?.file).toMatch(/don't match/);
    const htmlAsText = new File(["<html><body>hi</body></html>"], "notes.txt", {
      type: "text/plain",
    });
    expect((await appError(validateUpload(htmlAsText))).code).toBe("validation_failed");
    const ok = await validateUpload(
      new File(["a,b\n1,2\n"], "data.csv", { type: "application/octet-stream" }),
    );
    expect(ok.type.mime).toBe("text/csv; charset=utf-8");
  });

  it("refuses files over the size limit", async () => {
    const big = new File([new Uint8Array(21 * 1024 * 1024)], "big.pdf");
    expect((await appError(validateUpload(big))).code).toBe("payload_too_large");
  });

  it("strips EXIF (incl. GPS) from JPEGs and cleans file names", () => {
    const exif = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    const jfif = [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
    const scan = [0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9];
    const jpeg = new Uint8Array([0xff, 0xd8, ...exif, ...jfif, ...scan]);
    expect([...stripJpegMetadata(jpeg)]).toEqual([0xff, 0xd8, ...jfif, ...scan]);
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName('a<b>"c".pdf')).toBe("abc.pdf");
  });

  it("stores private files under id-only keys in the private bucket", async () => {
    const fileId = await uploadEngagementFile(makeCtx(), manager, projectB, {
      file: pdf("Secret Plans.pdf"),
      label: "",
      visibility: "internal",
    });
    const row = await db
      .select({ key: schema.mediaAssets.storageKey, bucket: schema.mediaAssets.bucket })
      .from(schema.engagementFiles)
      .innerJoin(schema.mediaAssets, eq(schema.mediaAssets.id, schema.engagementFiles.mediaId))
      .where(eq(schema.engagementFiles.id, fileId))
      .get();
    expect(row?.bucket).toBe("private");
    expect(row?.key).toBe(`engagements/${projectB}/${fileId}`);
    expect(await testEnv.MEDIA.head(row?.key ?? "")).toBeNull();
    expect(await testEnv.PRIVATE.head(row?.key ?? "")).not.toBeNull();
  });
});
