# Imagery and media

## Ratios

| Ratio | Use |
|---|---|
| 21:9 | Project features and case-study heroes (laptop and desktop), chapter plates |
| 16:9 | Film and video, embeds |
| 3:2 | Landscape project tiles, galleries |
| 4:5 | Portrait tiles; mobile features and heroes |
| 9:16 | Mobile station plates, vertical film |
| 1.91:1 | Social images (1200 × 630) |

## Rules

- **Real work only:** captures and recordings of delivered sites, used with the client's approval, with their colours kept accurate.
- **Environment imagery** comes from VORA's own Blender world. Environment plates and film share one grade: cool mineral shadows and a lagoon highlight. Client captures are never graded.
- **Art direction:** `<picture>` with a crop per breakpoint. Crops follow the media library's focal point (`focalX`/`focalY`). Portrait mobile gets its own framing.
- **No fake device mockups.** Screens are shown flat and full-bleed; long pages scroll inside an aperture.
- **Alt text** is required before publishing; decorative layers use `alt=""`. Captions add context and never replace alt text.
- **Loading:**
  - width and height always set;
  - lazy below the fold;
  - one `fetchpriority="high"` image per page;
  - a dominant-colour placeholder, then a 320 ms fade on decode;
  - AVIF → WebP → JPEG at 480–2560 px.
- **Video:**
  - ambient loops (≤ 12 s) are muted, `playsinline`, and play only in view, with a pause control when longer than 5 s;
  - films never autoplay with sound, have keyboard controls, and have captions for any speech;
  - reduced motion shows the poster only.
- **Lightbox:**
  - a `<dialog>` on basalt at 96%, with the image contained, the caption, `03 / 12`, previous/next and close;
  - `Esc`, arrow keys and swipe work; pinch-zoom is never blocked;
  - focus returns to the image.
- **Hover:** the settle (1.04 → 1.0) and the title underline only. No greyscale flips, tilts or zoom beyond 1.08.
