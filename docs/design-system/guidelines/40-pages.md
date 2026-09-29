# Pages

Every route below already exists in the code (`app/routes.ts`), except where it is marked as a proposal.

| Page | Route | Theme | Direction |
|---|---|---|---|
| Home | `/` | Basalt + one Mist chapter | Six stations — **Threshold** (wordmark + one positioning line) · **Approach** (what VORA is, two sentences) · **Chambers** (published featured work) · **Terraces** (the four services and their delivery labels) · **Reflection** (Mist: "Creative by Solara. Digital by VORA.") · **Horizon** (the invitation). It ships as a typographic T0 version until the Blender renders arrive (D9). |
| Work | `/work` | Basalt | A live count label (`02 PROJECTS`); a sequence of ProjectFeatures while there are fewer than 4 projects; staggered tiles from 4; filters only from 6 projects in at least 2 categories; the existing empty state |
| Case study | `/work/:slug` | Basalt | A hero aperture that morphs from Work; ProjectFacts; content blocks alternating text and media; Credits; NextProject. Facts only. |
| Services | `/services` | Basalt | Four ServiceRows (Websites first), the ProcessLine, the invitation |
| Service | `/services/:slug` | Basalt | Websites (VORA — the richest page, with real site captures) · Branding / Motion / Film (with Solara Studios — "who does what" split, delivery labels). Related work appears only when it exists. |
| Our Story | `/our-story` | Basalt + Mist quote | A chaptered long-read: each real statement is a shot; "Design × Technology × Identity" as a triptych; the Process line; the founder's quote |
| Partners | `/partners` | **Mist** | PartnerStatement; the Solara entry; the three principles; services delivered together; partnership contact |
| Careers | `/careers`, `/careers/:slug` | Basalt | The values Craft · Taste · Reliability; published roles only (CareerRow); the existing empty state; "Introduce yourself" as the closing line |
| Contact | `/contact` | Basalt | A sticky context column (what happens next, other addresses) and the EnquiryForm; the in-place success state with the reference |
| Legal | `/terms`, `/privacy`, `/cookies` | **Mist** | Display-m title, "Last updated", a sticky contents list, text at the measure. Never publish placeholder notices. |
| Status | `/status` | Basalt | The existing headline, a DM Mono timestamp and the component table with status squares |
| System | 404, errors, maintenance, auth | Basalt | The existing copy; calm, typographic, and never revealing whether an account exists |
| Design | — | — | **Not in the code (D18).** Either a CMS service entry (no code change) or part of Websites (recommended until decided) |
| Journal | — | — | **Not in the code (D19).** A new content type, routes, RSS and CMS screens. Deferred until three articles exist. |
