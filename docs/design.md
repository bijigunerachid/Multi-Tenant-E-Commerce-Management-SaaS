# Design: "Stockroom"

Vendora is the back office of independent shops: stock, orders and customers, used all day by
owners and their staff. The interface takes its look from the back room of a shop, where stock
lives: spruce shelving, paper, and the shelf label on every item.

## Tokens

Defined once in `frontend/src/index.css` (`@theme`) and used through Tailwind classes.

| Token     | Value                 | Used for                                                  |
| --------- | --------------------- | --------------------------------------------------------- |
| brand-800 | `#163C33` spruce      | Sidebar                                                   |
| brand-600 | `#1F5A47`             | Primary buttons, links, focus outlines                    |
| ink-50    | `#F5F7F4` paper       | Workspace background                                      |
| ink-900   | `#18211E`             | Text                                                      |
| ink-500   | `#64746C`             | Secondary text (4.9:1 on white, 4.6:1 on paper)           |
| amber     | Tailwind amber        | Stock that needs attention, and nothing else              |
| red       | `#B3412E` brick scale | Errors, cancellations, destructive actions                |
| chart     | `#1F8060`             | The single data series (passes the dataviz palette check) |

Type: Figtree for the interface; JetBrains Mono only for codes read character by character
(SKUs, order numbers). Both are served with the app, so there are no third-party font requests.

## Rules

- **One bold element: the shelf label.** SKUs are shown with `<Sku>`: monospaced, a hairline
  border and the punched hole of the Vendora tag (the logo is a shelf tag too). Nothing else
  competes with it.
- **Flat on paper.** Cards have a hairline border and small corners, no shadow. Only floating
  layers (menus, dialogs, toasts) cast a shadow, so elevation always means "on top".
- **Amber is reserved.** It marks low stock; other warnings use their own wording and icon.
  The current page in the sidebar is marked with a pale edge, not a colour.
- **Sentence case everywhere**, including headings, buttons and table headers; no all-caps
  labels. (The Web Interface Guidelines ask for Title Case; Vendora keeps sentence case, which
  `frontend-design` recommends and every existing screen and test already uses.)
- **Words:** active verbs that say what happens ("Archive store", "Leave and discard
  changes"), the same name for an action through the whole flow, errors that say how to fix it.

## Public site

Visitors at `/` get the homepage (`features/marketing`); signed-in people get the app at the
same address, and every other private page still sends visitors to sign in. `/pricing` is public
for everyone. The rules above apply, plus:

- **Only true statements.** Every claim describes something Vendora does today. No
  testimonials, customer logos or usage figures until real ones exist.
- **Prices from one place.** The pricing page, the homepage summary and the FAQ answers about
  plans are built from `GET /api/v1/plans`, so they cannot disagree with Billing.
- **The hero is the stockroom.** An inventory slice drawn with the app's own components,
  labelled "Example". Its one moment of motion (a sale bringing a product to low stock) plays
  only when motion is welcome; otherwise the settled state is shown.
- **Sections are not a card kit.** Hairline-separated lists, the real order lifecycle, and the
  real role table (mirroring `permissions.js`).

## Web Interface Guidelines: what is enforced where

| Rule                                     | Where                                                        |
| ---------------------------------------- | ------------------------------------------------------------ |
| Loading states end with "…"              | `SkeletonRows`, `FullPageSpinner`                            |
| Search placeholders end with "…"         | Every search field                                           |
| Reduced motion                           | `index.css` (spinners keep turning: they carry meaning)      |
| `touch-action: manipulation`, tap colour | `index.css`                                                  |
| Native selects with explicit colours     | `index.css`                                                  |
| `text-wrap: balance` / `pretty`          | Headings / paragraphs, `index.css`                           |
| `theme-color`, `color-scheme`            | `index.html`                                                 |
| Dialogs contain their scroll             | `Dialog` (`overscroll-contain`, phone gutter)                |
| Toasts readable before they go           | `Toast`: errors stay 10 s, pause on hover and keyboard focus |
| Images reserve their space               | Product images: `width`, `height`, `loading="lazy"`          |
| No spellcheck on emails                  | `TextField` with `type="email"`                              |
| Unsaved changes warning                  | `useUnsavedChanges` on the product and order forms           |
| Codes not machine-translated             | `<Sku>`, the logo (`translate="no"`)                         |
| Tabular numbers in number columns        | Tables, KPI tiles                                            |
