# Aperture

A rectangular, sharp-cornered window onto real media: the frame stays still while the view inside moves.

**Use it for:** every image, film still and plate on the public site — project covers, case-study images, service plates.

**The consumer provides:** the media (a `<picture>` with art-directed sources, or a video with a poster), its alt text, the ratio (`21 / 9`, `16 / 9`, `3 / 2`, `4 / 5` or `9 / 16` via `--ratio`), the focal point (`focalX`/`focalY` from the media library → `object-position`) and the dominant colour for the placeholder.

**Rules**

- Radius `radius-0`. No borders, shadows or rounded corners.
- It opens with `clip-path` (inset 10% → 0 over about 1100 ms, `ease-out`) while the image settles from 1.06 to 1.0 — once, on entry.
- Parallax happens inside the frame only, at most 8% of its height.
- Until real media exists, show the survey-drawing plate (`v-plate`) with a slot label — never a stock photo or an AI image.
- Reduced motion: the aperture is simply open.
