# ProjectTile

Projects in the Work index once there are four or more: apertures at 4:5 or 3:2, alternating and offset — never a uniform grid.

**The consumer provides:** a published project (title, category, one-line summary, cover media).

**Behaviour**

- The whole tile is one link: the title's `<a>` is stretched over the tile, and the focus ring wraps it.
- **Hover** (fine pointers): the image settles from 1.04 to 1.0 inside a still frame (`dur-medium`) and the title underline draws.
- **Touch:** a plain link, no hover dependency.

**Rules:** below four projects, use ProjectFeature instead. With no cover, show a typographic plate (the title on `color-surface`), never stock imagery.
