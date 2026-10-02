# UX

Information architecture and the core loop. Sources: [screen inventory](https://docs.google.com/document/d/1zrz46A2NuD58ZTcYbNxdmGeEFN3HeVxPJORLHRAp4lc/edit), [Home deep-dive](https://docs.google.com/document/d/1qfOiEdU3pNBnE21VF0i6nOFW1OLqhppGsl6tet-gIlA/edit), [property detail](https://docs.google.com/document/d/10lVbzuoaI1cANrXI6YDaO2D0mxHgQSnbQNaSajKvH4g/edit).

`apps/mobile` implements the tab shell only. Everything below is the spec the screens will fill in.

## Principles

1. The property is the home object.
2. An obligation is not a payment.
3. Tracking, not money movement.
4. Spanish-first and Mexico-ready: predial, CFE, agua, folio, comprobante.
5. The core loop beats a dashboard.

## Five tabs

| Tab | Primary job |
| :---- | :---- |
| **Inicio** | Overdue and due-soon across every property, plus the next action |
| **Propiedades** | Cards to a property detail and its obligations |
| **Pagos** | Upcoming, overdue, and history |
| **Mantenimiento** | Active and completed, lighter in the MVP |
| **Documentos** | Receipts and property files, including the OCR review |

Settings, notifications, and categories enter from the profile avatar, not a tab. Calendar and reports are later. The tab count is a product lock.

## Core loop

**A Configurar → B Recordar → C Registrar + Comprobar → D Repetir → E Parcial / No aplica**

Home is the launcher from remind to record. The loop has to close in a couple of taps or reminders stop mattering.

## Screens

Auth and onboarding: A1 Bienvenida · A2 Crear cuenta · A3 Iniciar sesión · A4 Primera propiedad · A5 Primeras obligaciones (chips for Predial, CFE, Agua, plus a custom option)

Inicio: H1 Inicio · H2 Detalle de alerta (from a push notification)

Propiedades: P1 Lista · P2 Nueva/Editar · P3 Detalle · P4 Obligaciones · P5 Nueva/Editar obligación · P6 Archivar

Pagos: Pay1 Lista (Próximos · Atrasados · Historial) · Pay2 Detalle · Pay3 Registrar pago · Pay4 Adjuntar comprobante

Mantenimiento M1–M3 · Documentos D1–D3 plus D-OCR · Buscar Q1

Payment list statuses in Spanish: Próximo · Por vencer · Atrasado · Pagado · Pago parcial · No aplica.

## H1 Inicio

Top bar: title **Inicio**, search, and the profile avatar.

Summary strip, three chips:

| Chip | Source | Tap |
| :---- | :---- | :---- |
| **Atrasados · N** | overdue | Filter to Atrasados |
| **Por vencer · N** | due within 7 days | Filter to Por vencer |
| **Este mes · $X** | paid this month in MXN | Optional, to the payment history |

Primary list, **Próximas acciones**, ordered overdue (oldest first), then due today, then due within 7 days. Each row: category icon, obligation title, property name with a due label, expected amount, a **Registrar** button, and an overflow with Posponer, Ver obligación, and Marcar no aplica.

Due labels: "Venció hace {n} día(s)" · "Vence hoy" · "Vence mañana" · "Vence el {d} {mon}".

Secondary: a **Sin comprobante** section for payments in the last 30 days with no evidence, each offering **Agregar comprobante**. Mini property cards appear only when the urgency list is short.

Empty states: with no properties, "Agrega tu primera propiedad…" and an **Agregar propiedad** button. With nothing due, "Nada atrasado. Próximo: {title} · {date}".

H2 is one expanded row reached from a push: Registrar pago is primary, with Posponer, Marcar no aplica, and Ver propiedad.

The feed comes from `GET /v1/home/action-items`, sorted by status priority then due date, capped near 50.

## P3 Property detail

Header: name, a type chip, the city, and an overflow with Editar and Archivar. The same three summary chips, scoped to this property.

Tabs: **Obligaciones** (default) · **Pagos** · **Mantenimiento** · **Documentos** · **Resumen** (light, can stub).

The Obligaciones tab sections: **Activas** (overdue, then due soon, then upcoming), **Pausadas**, and **Archivadas** (collapsed). Each row shows the category icon, title, next due date, expected amount, and a status badge. A floating button adds an obligation. The row overflow on an active obligation: Registrar pago, Marcar no aplica, Posponer, Pausar, Editar, Archivar.

## Forms

**Property:** Nombre\* · Tipo\* (Casa / Depto / Terreno / Local / Otro) · Dirección · Estado/Municipio · Estatus (propia / rentada / familiar / inversión) · Notas · MXN

**Obligation:** Categoría\* · Nombre\* · Proveedor · Frecuencia\* · Próxima fecha\* · Monto esperado · Recordatorios (**7d and 1d** by default) · Método · Notas · Activa

Categories in Spanish: Predial · Agua · CFE/Electricidad · Gas · Internet · Mantenimiento/HOA · Hipoteca · Seguro · Seguridad · Otro.
Recurrence in Spanish: Mensual · Bimestral · Trimestral · Semestral · Anual · Personalizada · Irregular/única.

## Record a payment

Pay3 records something the person already paid. The screen never offers to pay a bill, link an account, or charge a card. **Guardar** works without a comprobante; the UI encourages one through the Sin comprobante affordance and warns once per session. Pay4 attaches evidence afterward.

A partial amount sets the period to Pago parcial and leaves the due date where it is.

## No aplica, Pausar, Archivar

| Action | Effect |
| :---- | :---- |
| **Marcar no aplica** | Skips this period only. The obligation stays active and the next due date is recalculated. No undo in the MVP. |
| **Pausar** | No new periods or reminders until Reanudar. |
| **Archivar** | Hidden from the active portfolio. History stays. |

Confirmation copy for no aplica: "Se omite solo este periodo. La obligación sigue activa y el próximo vencimiento se recalcula."

Three separate affordances. Collapsing them into one control would lose the distinction the product locked.

## Documentos and OCR

The list shows documents for the property with type chips: recibo, seguro, contrato, **hipoteca/escritura**, garantía, otro. A document whose OCR job is `suggested` gets a **Revisar datos** badge.

Upload (D2):

1. Pick a PDF or a photo, which uploads to private storage.
2. The document row persists.
3. An OCR job is enqueued, mortgages and deeds first.
4. Show the processing state: "Extrayendo datos…".

### D-OCR, the review sheet

When the job reaches `suggested`:

| Element | Behavior |
| :---- | :---- |
| Header | The document name and "Sugerencias del documento" |
| List | Each suggestion: the Spanish field label, the suggested value, confidence when available, and an editable field |
| Edit | The person may change any value before confirming |
| Primary | **Aplicar seleccionadas**, which posts the per-suggestion decisions |
| Secondary | **Descartar todo**, which rejects the job |
| Failed | Retry, or keep the document with no suggestions |

Microcopy: "Revisa y confirma antes de guardar. Nada se aplica solo."

Nothing is written to an obligation, a payment, or a property until the person confirms. A rejected suggestion stays rejected and the document stays stored. This screen is not built yet; the Documentos tab in `apps/mobile` says so.

## Client behavior

Online-first with an outbox for writes. An `Idempotency-Key` on payment and evidence creates so a retry does not duplicate a row. The server wins a conflict.

## Analytics

`home_viewed`, `home_action_tapped` (registrar | snooze | na | evidence), `home_empty_cta`, plus `ocr_suggested`, `ocr_confirmed`, and `ocr_dismissed`.

## Acceptance checks for Home

1. Two properties with a mix of overdue and due-soon: overdue sorts above due-soon.
2. A push leads to H2 and then to Pay3 with the right obligation.
3. After a payment with evidence, the row leaves the list and the monthly chip updates.
4. Saving without evidence may put the payment under Sin comprobante.
5. Spanish-only strings on this screen in the MVP.

## Open questions

Whether to allow saving without a comprobante on a free tier (the brief says do not gate it), and whether default reminder offsets should differ for predial, CFE, and agua.
