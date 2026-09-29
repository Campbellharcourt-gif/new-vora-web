# ServiceRow

The four services as editorial rows between hairlines: index, name at display size, summary, delivery label, arrow.

**The consumer provides:** the published services in `sortOrder` (name, summary, `deliveryModel`, partner) and, optionally, one real image each for the hover aperture.

**Delivery label** (decision C2/D4 — it states who does the work):

- `vora` → DELIVERED BY VORA
- `partner` → CREATIVE BY SOLARA STUDIOS · DIGITAL BY VORA
- `joint` → VORA × SOLARA STUDIOS

**Behaviour**

- **Hover** (fine pointers): the hairline strengthens (`color-line-strong`) and, if the CMS has an image for the service, an aperture opens at columns 9–12. No image means no window.
- **Touch:** a plain link.
- **Don't** turn services into icon cards.
