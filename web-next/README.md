# Attendance Website — Next.js (web-next)

## Ye folder kya hai?

Ye folder naya **Next.js website** ka foundation hai. Iska kaam hai purane
`index.html` (Vanilla JS) website ko dheere-dheere Next.js me rebuild karna.

**Important:** Ye ek **alag** project hai:

- `web-next/` → naya Next.js website (ye folder)
- `server/` → existing Express backend (unchanged — yehi API aur DB layer hai)
- `mobile/` → existing React Native / Expo mobile app (bilkul untouched)
- `index.html` → purana website (unchanged — jab tak parity nahi hoti, yehi chalta rahega)

Website aur mobile app **dono same Express backend aur same SQL Server** use karte
hain. Is phase me koi naya backend nahi banaya gaya.

## Dependencies install kaise karein

Sabse pehle is folder ke andar jao aur dependencies install karo:

```bash
cd web-next
npm install
```

Ye `node_modules/` aur `package-lock.json` sirf `web-next/` ke andar banayega —
root project ya mobile app par koi asar nahi.

## Development server kaise chalayein

```bash
cd web-next
npm run dev
```

Phir browser me kholo:

```
http://localhost:3000
```

> Port `3000` use hota hai (Next.js ka default). Existing backend `4000` par hai aur
> purana website (Vite) `5173` par — koi port conflict nahi.

Production jaisa test karne ke liye:

```bash
npm run build
npm run start   # http://localhost:3000
```

Server band karne ke liye terminal me `Ctrl + C` dabao.

## API proxy kaise kaam karta hai

`next.config.mjs` me ek **rewrite** hai jo `/api/*` request ko existing Express
backend par forward karta hai:

- Browser → `http://localhost:3000/api/health`
- Next.js server-side → `http://localhost:4000/api/health`

Iska matlab:

- API path, HTTP method, query params, request body aur response status **same** rehte hain.
- Browser **kabhi** SQL Server se direct connect nahi karta.
- DB credentials / JWT secret browser bundle me **nahi** jate (wo sirf backend ke `.env` me hain).

Backend kisi aur address par ho to env se change kar sakte ho:

```bash
# Windows PowerShell (development)
$env:API_PROXY_TARGET = "http://192.168.1.10:4000"
npm run dev
```

Default `http://localhost:4000` hai.

**Note (production build):** `next start` ke liye backend origin `next build` ke time
bake ho jata hai (Next.js rewrites ka normal behavior). Isliye production ke liye pehle
env set karke build karo, phir start karo:

```bash
$env:API_PROXY_TARGET = "http://192.168.1.10:4000"
npm run build
npm run start
```

## Loading aur Error components

- `components/LoadingState.jsx` → spinner + "Loading data..." message. `compact` prop se
  chhota inline spinner bhi mil sakta hai.
- `components/ErrorState.jsx` → clear error message + `Retry` button (jab `onRetry` pass karo).
- `lib/api.js` → centralized `apiFetch()` — response/error handling ek jagah hai.
  Aage ke phase me login ke baad JWT `Authorization` header yahin se add hoga
  (abhi koi naya auth nahi hai).

Ye components sirf foundation hain — abhi koi pura screen rewrite nahi hua.

## Abhi kaunse features migrate NAHI hue

- HR Admin Login / SuperAdmin Login / Employee Login (agle phase me)
- Employee tabs (Dashboard, Attendance, Leave, Reports, Celebrations, Full & Final, Profile)
- HR Admin tabs (Overview, Roster, Audit, Analytics, Daily Master, etc.)
- SuperAdmin console

Abhi sirf ek **preview page** hai jo backend `/api/health` se real connection check karta hai.

## Agar preview me problem ho to

1. Pehle check karo ki Express backend chal raha hai (port `4000`):
   `npm run server` (root folder me).
2. `web-next` folder me `npm run dev` dobara chalao.
3. Agar Next.js preview theek nahi lag raha, purana website waise hi chal raha hai:
   root folder me `npm run dev` (port `5173`).

Koi data delete ya overwrite nahi hota — dono website saath-saath chal sakti hain.

---

## PHASE 2 — Login + Authentication

### Kaunse login routes bane

- `/login` → role selection (HR Admin ya Employee)
- `/login/hr` → HR Admin login form
- `/login/employee` → Employee login form
- `/employee` → protected employee portal (login ke baad)
- `/hr` → protected HR Admin portal (login ke baad)
- `/health` → backend status check

### Login request backend tak kaise pahunchta hai

1. Browser form → Next.js route handler `/api/auth/hr` ya `/api/auth/employee`
   (ye Next ke apne server-side handlers hain, proxy nahi).
2. Ye handler **existing backend** `POST /api/auth/hr/login` / `POST /api/auth/employee/login`
   ko call karta hai (password/PIN verification backend me hi hoti hai — koi duplicate
   auth nahi).
3. Success par token **httpOnly cookie** `auth_token` me set hota hai (browser JS se hidden).
4. Aage ke `/api/*` calls par `middleware.js` cookie se `Authorization: Bearer` header
   bana deta hai, aur Phase 1 ka rewrite backend ko forward karta hai.

### Session / security

- Token **httpOnly, SameSite=Lax, secure (production)** cookie me rehta hai —
  legacy `sessionStorage` se zyada safe.
- Asli identity backend se aati hai (JWT + `dbo.tblemployee`) — browser ka paycode
  sirf credential ke roop me jata hai, pehchaan nahi banata.
- Backend ke saare checks waise hi hain: `authenticate`, `requireRole`,
  `requirePasswordChanged`, `requirePinSetupDone`, company-scope. Kuch bhi bypass nahi.
- Employee `mustChangePassword` / `pinSetupRequired` gate: portal access **block** hota
  hai (jaisa backend enforce karta hai) — ye screens agle phase me aayengi.
- Galat role ka page khole to redirect hota hai (HR ↔ Employee). Session expire/invalid
  ho to `/login` par redirect.

### Kaise chalayein

```bash
cd web-next
npm install
npm run dev     # http://localhost:3000
```

### Tests (Phase 2)

- `npm run build` → PASS
- Login page load, valid/invalid HR login, valid/invalid employee login, logout,
  wrong-role redirect, no-secret-in-bundle — sab runtime par backend ke against test kiye.

### Abhi migrate NAHI hue

- Employee dashboard/attendance/leave/reports/profile tabs
- HR Admin tabs (overview, roster, audit, analytics, daily master, email, salary, holidays)
- SuperAdmin website console (legacy website me nahi tha — screenshots ke baad)

---

## PHASE 3 — Login UI redesign + 3 role cards + 4 themes

### Teeno role cards

`/login` par ab 3 clear role cards hain:

- **HR Admin** (shield icon) → `/login/hr`
- **Employee** (person icon) → `/login/employee`
- **SuperAdmin** (security icon) → `/login/superadmin`

Desktop par 3 ek row me, tablet par 2 column, mobile par stacked (clean, readable).

### SuperAdmin status

Legacy website me SuperAdmin login flow **nahi tha** (mobile app ka SuperAdmin alag hai).
Isliye website ka SuperAdmin card visible hai lekin `/login/superadmin` par
**"Website access setup pending"** message dikhta hai — koi fake login ya dummy
endpoint nahi banaya. Ye agle phase me migrate hoga (screenshots ke baad).

### Chaar themes

- Dark Purple (default)
- Light Professional
- Midnight Blue
- Emerald Dark

Theme selector `/login` par hai. Theme turant (bina reload) lagta hai, background/cards/
text/borders/buttons/focus sab change hote hain, aur `localStorage` (`attendance_theme`)
me save hota hai. Paint se pehle `<html data-theme>` set hota hai (FOUC avoid). Theme
preference login routes ke beech bhi bana rehta hai. Sirf theme preference save hota hai —
koi credential/token localStorage me nahi jata.

### Login forms

- Show/hide password button (eye icon) dono forms me.
- Clear labels, loading state, disabled submit, friendly errors, "← Back" link.

### Connected login flows

- HR Admin → existing backend `POST /api/auth/hr/login` (Phase 2 integration unchanged)
- Employee → existing backend `POST /api/auth/employee/login` (Phase 2 integration unchanged)
- SuperAdmin → **pending** (website flow abhi nahi hai)

### Commands

```bash
cd web-next
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
npm run start   # production (build ke baad)
```

---

## PHASE 3.1 — Branding + real SQL status + consistent forms

### Branding (old Attendance Portal)

`components/PortalBranding.jsx` sab login pages par dikhta hai:
- Fingerprint logo (inline SVG, koi external asset nahi)
- **"Attendance Portal"** heading
- **"Savior Biometric SQL Server • Self Service & HR Admin"** subtitle
- DB connection status badge

### Real SQL Server status

`components/DbStatusBadge.jsx` existing backend **`GET /api/diagnostics/db`** use karta hai.
Ye endpoint explicitly `status: connected | unavailable | not_configured` deta hai:

- `connected` → **"Savior SQL Server: Connected"**
- `unavailable` / `not_configured` → **"Savior SQL Server: Disconnected"**
- request fail / timeout / unknown → **"Savior SQL Server: Status unavailable"**

Sirf `success` + `status` read hote hain — `config`/`database`/`message` (server host, DB name,
raw error) browser me **nahi** dikhaye jate. Click = manual re-check, koi auto-polling nahi.
Status check login form ko block nahi karta.

### Consistent login forms

HR Admin aur Employee forms ab ek jaisi visual structure share karte hain:
- Branding + status badge + role heading
- Input fields with leading icons (person / id-card / lock)
- Password show/hide (eye) control
- Full-width login button + loading + friendly errors + "← Back to role selection"

Authentication logic (field names, endpoints, PIN/password gates, session, redirects) —
**bilkul unchanged**.

---

## PHASE 4 — Employee Portal (real data)

### Kaise kaam karta hai

- Employee login ke baad `/employee` par protected **Employee Portal** khulta hai (Phase 2/3
  jaisa httpOnly cookie + middleware). Identity backend `/api/me` se aati hai (JWT → paycode).
- Server-side `app/employee/layout.js` role verify karta hai — bina login `/login` par redirect,
  galat role (HR) `/hr` par redirect, `mustChangePassword`/`pinSetupRequired` gate block karta hai.

### Sections (sab real authenticated-employee data)

- **Dashboard** → `/api/employee/dashboard` + `/api/employee/shift` (summary, shift, recent, late)
- **Attendance** → month navigation + daily rows (status/in/out/hours)
- **Leave** → `/api/employee/leave/balance` + `/leave/requests`
- **Reports** → monthly summary + grace + late details
- **Celebrations** → `/api/employee/celebrations` (birthdays / work / marriage anniversaries)
- **Full & Final** → `/api/employee/fullfinal` (ESTIMATE only; salary import nahi ho to honest "not available")
- **Profile** → `/api/employee/profile` (name, paycode, card, dept, designation, DOJ, ...)

### Security

- Har `/api/employee/*` route backend me `req.user.paycode` (JWT) se identity enforce karta hai —
  browser se koi paycode/ID override nahi hota, cross-employee access 403.
- Employee HR routes access nahi kar sakta (403), HR employee banna nahi sakta.

### Commands

```bash
cd web-next
npm install
npm run dev     # http://localhost:3000
```

---

## PHASE 5 — HR Admin Portal (real data)

### Kaise kaam karta hai

HR login ke baad `/hr` par protected **HR Admin Portal** khulta hai (Phase 2/3 jaisa
httpOnly cookie + middleware). `app/hr/layout.js` server-side role verify karta hai —
bina login `/login`, Employee `/employee` par redirect. Employee HR pages/APIs access
nahi kar sakta (403).

### Modules (sab real authenticated-HR data)

- **Overview** → `/api/hr/dashboard` + `/api/hr/category-analytics` (summary + dept-wise)
- **Employees** → `/api/employees` (search + real roster: paycode/name/card/dept/designation/company)
- **Audit** → employee search → `/api/hr/audit/:paycode?month=` (summary + daily rows)
- **Analytics** → `/api/hr/category-analytics?mode=daily|weekly|monthly` (company/dept split)
- **Celebrations** → `/api/hr/celebrations` (marriages) + `/api/employees` (birthdays this month)
- **Marriage** → `/api/marriage-anniversary` (application storage list)
- **Email** → `/api/email/config` (provider status — **SMTP/API keys kabhi browser me nahi**)
- **Leave** → `/api/hr/leave/balances` + `/api/hr/leave/requests` (read-only)
- **Salary** → `/api/hr/salary/master` (list; import nahi ho to honest empty)
- **Holidays** → `/api/hr/holidays` (list)

### Abhi migrate NAHI hue (pending)

- Holiday create/edit/delete, Leave apply/approve, Salary import/config, Email test/send —
  ye write/action flows abhi website me nahi (backend endpoints exist). Abhi read-only
  status/list. SuperAdmin console bhi abhi pending.

### Security

- Identity backend JWT se (`req.user`); browser se koi role/paycode override nahi.
- Company-scope aur role checks backend me hi hain — website bypass nahi karta.





