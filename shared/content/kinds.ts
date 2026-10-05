/** CMS content types, shared by the admin UI and the content service. */
export const CONTENT_KINDS = ["project", "service", "page", "partner", "job_role"] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const CONTENT_LABELS: Record<ContentKind, { one: string; many: string }> = {
  project: { one: "Case study", many: "Case studies" },
  service: { one: "Service", many: "Services" },
  page: { one: "Page", many: "Pages" },
  partner: { one: "Partner", many: "Partners" },
  job_role: { one: "Role", many: "Careers" },
};

/** Admin list path per type (pages live under the Content hub). */
export const CONTENT_ADMIN_PATH: Record<ContentKind, string> = {
  project: "/admin/projects",
  service: "/admin/services",
  page: "/admin/content/pages",
  partner: "/admin/partners",
  job_role: "/admin/careers",
};

/** Where a live item appears on the public site. */
export function contentPublicPath(kind: ContentKind, key: string): string | null {
  switch (kind) {
    case "project":
      return `/work/${key}`;
    case "service":
      return `/services/${key}`;
    case "job_role":
      return `/careers/${key}`;
    case "partner":
      return "/partners";
    case "page":
      return key === "our-story" ? "/our-story" : `/${key}`;
  }
}

/** The content type an admin URL belongs to (/admin/<segment>/…). */
export function contentKindFromPath(pathname: string): ContentKind | null {
  const segment = pathname.split("/")[2];
  switch (segment) {
    case "projects":
      return "project";
    case "services":
      return "service";
    case "partners":
      return "partner";
    case "careers":
      return "job_role";
    case "content":
      return "page";
    default:
      return null;
  }
}

export interface ContentField {
  name: string;
  label: string;
  kind: "text" | "url" | "date" | "number" | "textarea" | "select" | "checkbox" | "body";
  required?: boolean;
  maxLength?: number;
  hint?: string;
  options?: readonly { key: string; label: string }[];
  /** Asked for when creating (the rest is filled in on the editor). */
  onCreate?: boolean;
}

const SLUG_HINT = "The web address: lower-case letters, numbers and hyphens.";
const BODY: ContentField = { name: "body", label: "Content", kind: "body" };
const SEO: ContentField[] = [
  { name: "seoTitle", label: "Search title", kind: "text", maxLength: 160 },
  {
    name: "seoDescription",
    label: "Search description",
    kind: "textarea",
    maxLength: 320,
    hint: "Shown by search engines. Leave empty to use the summary.",
  },
];
const ORDER: ContentField = {
  name: "sortOrder",
  label: "Order",
  kind: "number",
  hint: "Lower numbers appear first.",
};

export const CONTENT_FIELDS: Record<ContentKind, ContentField[]> = {
  project: [
    { name: "title", label: "Title", kind: "text", required: true, maxLength: 160, onCreate: true },
    {
      name: "slug",
      label: "Address",
      kind: "text",
      required: true,
      maxLength: 80,
      hint: SLUG_HINT,
      onCreate: true,
    },
    { name: "category", label: "Category", kind: "text", maxLength: 120 },
    { name: "summary", label: "Summary", kind: "textarea", maxLength: 500 },
    { name: "year", label: "Year", kind: "number" },
    { name: "clientName", label: "Client name (as shown publicly)", kind: "text", maxLength: 160 },
    { name: "externalUrl", label: "Live site", kind: "url" },
    BODY,
    { name: "isFeatured", label: "Feature on the home page", kind: "checkbox" },
    ORDER,
    ...SEO,
  ],
  service: [
    { name: "name", label: "Name", kind: "text", required: true, maxLength: 120, onCreate: true },
    {
      name: "slug",
      label: "Address",
      kind: "text",
      required: true,
      maxLength: 80,
      hint: SLUG_HINT,
      onCreate: true,
    },
    { name: "summary", label: "Summary", kind: "textarea", maxLength: 500 },
    {
      name: "deliveryModel",
      label: "Delivered by",
      kind: "select",
      required: true,
      onCreate: true,
      options: [
        { key: "vora", label: "VORA" },
        { key: "partner", label: "A partner" },
        { key: "joint", label: "VORA with a partner" },
      ],
    },
    {
      name: "partnerId",
      label: "Partner",
      kind: "select",
      hint: "Required when a partner delivers the service.",
    },
    BODY,
    ORDER,
    ...SEO,
  ],
  page: [
    { name: "title", label: "Title", kind: "text", required: true, maxLength: 160 },
    { name: "intro", label: "Introduction", kind: "textarea", maxLength: 500 },
    BODY,
    ...SEO,
  ],
  partner: [
    { name: "name", label: "Name", kind: "text", required: true, maxLength: 120, onCreate: true },
    {
      name: "slug",
      label: "Address",
      kind: "text",
      required: true,
      maxLength: 80,
      hint: SLUG_HINT,
      onCreate: true,
    },
    {
      name: "relationship",
      label: "Relationship",
      kind: "text",
      required: true,
      maxLength: 160,
      hint: "For example: Creative partner.",
      onCreate: true,
    },
    { name: "description", label: "Description", kind: "textarea", maxLength: 1000 },
    { name: "statement", label: "Statement", kind: "textarea", maxLength: 1000 },
    { name: "url", label: "Website", kind: "url" },
    ORDER,
  ],
  job_role: [
    { name: "title", label: "Title", kind: "text", required: true, maxLength: 160, onCreate: true },
    {
      name: "slug",
      label: "Address",
      kind: "text",
      required: true,
      maxLength: 80,
      hint: SLUG_HINT,
      onCreate: true,
    },
    { name: "department", label: "Department", kind: "text", maxLength: 120 },
    {
      name: "employmentType",
      label: "Employment type",
      kind: "select",
      options: [
        { key: "full_time", label: "Full time" },
        { key: "part_time", label: "Part time" },
        { key: "contract", label: "Contract" },
        { key: "freelance", label: "Freelance" },
        { key: "internship", label: "Internship" },
      ],
    },
    {
      name: "locationType",
      label: "Location type",
      kind: "select",
      options: [
        { key: "remote", label: "Remote" },
        { key: "hybrid", label: "Hybrid" },
        { key: "onsite", label: "On site" },
      ],
    },
    { name: "locationText", label: "Location", kind: "text", maxLength: 160 },
    { name: "summary", label: "Summary", kind: "textarea", maxLength: 500 },
    BODY,
    {
      name: "applicationMode",
      label: "How people apply",
      kind: "select",
      required: true,
      options: [
        { key: "email", label: "By email (careers address)" },
        { key: "external", label: "On another site" },
      ],
    },
    { name: "externalUrl", label: "Application link", kind: "url" },
    { name: "closesOn", label: "Closes on", kind: "date" },
    ORDER,
  ],
};

/** "Projects" → a sensible address from a title ("New Site!" → "new-site"). */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}
