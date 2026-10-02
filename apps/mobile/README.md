# @property-control/mobile

Expo React Native + TypeScript client for Property Control. This is the navigation shell: the five locked tabs with placeholder Spanish copy. There is no data fetching, no auth, and no real screen yet.

## Run

From the repository root:

```bash
pnpm install
pnpm mobile:start
```

Then press `a` for Android, `i` for iOS on macOS, or `w` for web, or scan the QR code with Expo Go. `pnpm mobile:android` and `pnpm mobile:ios` go straight to a device. From this directory the scripts are `pnpm start`, `pnpm android`, `pnpm ios`, and `pnpm web`.

Type check:

```bash
pnpm --filter @property-control/mobile typecheck
```

A first `expo start` downloads native dependencies, so it needs network. The workspace sets `node-linker=hoisted` in `.npmrc` because Metro and Expo autolinking expect a flat `node_modules`.

## Tabs

Five tabs, Spanish labels, locked by Product: **Inicio · Propiedades · Pagos · Mantenimiento · Documentos**. Settings reach in from the profile avatar later, not a sixth tab.

```text
App.tsx                           SafeAreaProvider → NavigationContainer → AppTabs
index.ts                          registerRootComponent
src/navigation/tabs.tsx           the five-tab bottom navigator
src/screens/PlaceholderScreen.tsx shared placeholder
```

Each tab renders `PlaceholderScreen` with the job that screen will do. Replace them one at a time as the UX specs land; [docs/UX.md](../../docs/UX.md) has the screen inventory and the IDs (H1, P3, Pay3, D-OCR, and the rest).

## Next

In the product's priority order: Home (H1, H2) from `GET /v1/home/action-items`, then property detail and obligations, then record payment and evidence, then reminders, then documents with the OCR review sheet, then maintenance.

Two things to keep right when real screens arrive:

- **Pagos** records a payment the person already made somewhere else. The screen never offers to pay a bill or link an account. Saving works without a comprobante; evidence is optional and encouraged, not required.
- **Documentos** will hold the OCR review sheet (D-OCR). It shows each suggested field with its value, lets the person edit, and applies only what they confirm. Nothing is written to an obligation or a payment before that. The microcopy says so: "Revisa y confirma antes de guardar. Nada se aplica solo." See [docs/OCR.md](../../docs/OCR.md).

Writes will be online-first through an outbox, with an `Idempotency-Key` on payment and evidence creates so a retry cannot duplicate a row. The server wins a conflict.

The Mobile React Native write-up (due 3 Oct, see [docs/ROADMAP.md](../../docs/ROADMAP.md)) decides the state management, API client, and outbox details. This shell is deliberately thin so that write-up is not boxed in.
