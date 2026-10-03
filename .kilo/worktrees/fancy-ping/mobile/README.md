# Savior Attendance Mobile App

Mobile application for the Savior Biometric Attendance & HR Portal.

## Architecture

```
Mobile App (React Native / Expo)
    ↓ HTTPS API (Bearer JWT)
Existing Node/Express Backend (Port 4000)
    ↓ mssql Connection Pool
Savior SQL Server (SAVIOR921)
```

## Stack

- **Framework**: React Native with Expo SDK 52
- **Navigation**: React Navigation 7 (Stack + Bottom Tabs)
- **HTTP Client**: Axios with interceptors
- **State Management**: Custom lightweight store (Zustand-like)
- **UI**: React Native components with custom theme
- **Storage**: In-memory (dev) → Expo SecureStore (production)

## Project Structure

```
mobile/
├── App.js                      # Main entry point
├── app.json                    # Expo configuration
├── babel.config.js             # Babel configuration
├── metro.config.js             # Metro bundler config
├── package.json                # Dependencies
├── .env.example                # Environment template
├── src/
│   ├── navigation/             # Navigation structure
│   │   ├── RootNavigator.jsx   # Root nav (auth decision)
│   │   ├── AuthNavigator.jsx   # Auth stack
│   │   ├── EmployeeNavigator.jsx # Employee bottom tabs
│   │   └── HRNavigator.jsx     # HR bottom tabs
│   ├── screens/
│   │   ├── auth/               # Login screens
│   │   ├── employee/           # Employee screens (5)
│   │   └── hr/                 # HR screens (8)
│   ├── services/               # API & storage
│   │   ├── api.js              # Axios client
│   │   ├── storage.js          # Token storage abstraction
│   │   └── auth.js             # Auth service (placeholders)
│   ├── store/
│   │   └── authStore.js        # Auth state management
│   ├── components/             # Reusable UI components
│   ├── hooks/                  # Custom React hooks
│   ├── utils/                  # Constants, colors, formatters
│   └── types/                  # JSDoc type definitions
└── assets/                     # Images, icons
```

## Navigation Structure

```
AUTH (Stack)
├── RoleSelectionScreen
├── HRLoginScreen (Phase 2)
└── EmployeeLoginScreen (Phase 2)

EMPLOYEE (Bottom Tabs)
├── Dashboard
├── Attendance (Daily/Weekly/Monthly)
├── Leave (Balance/Apply/History)
├── Reports
└── Profile

HR ADMIN (Bottom Tabs)
├── Dashboard (Executive Overview)
├── Employees Roster
├── Employee Audit
├── Category Analytics
├── Daily Master Report
├── Birthdays & Anniversaries
├── Marriage Anniversary (Excel Import)
└── Leave Management
```

## Email Configuration
**EXCLUDED** from mobile app:
- Email Configuration tab
- Provider Config
- Brevo/SMTP settings
- Single/Bulk Email
- Email Templates/Logs/Scheduler

## Setup

```bash
cd mobile
npm install
npm start          # Start Expo dev server
npm run web        # Run on web browser
npm run android    # Run on Android emulator
npm run ios        # Run on iOS simulator (macOS only)
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
EXPO_PUBLIC_API_BASE_URL=http://localhost:4000/api
EXPO_PUBLIC_APP_NAME=Savior Attendance Mobile
EXPO_PUBLIC_APP_VERSION=1.0.0
```

**NEVER** put SQL credentials, JWT secrets, or email credentials in mobile app.

## API Integration (Phase 2)

The app connects to existing backend APIs:
- Authentication: `/api/auth/hr/login`, `/api/auth/employee/login`
- Employee: `/api/employee/*`
- HR: `/api/hr/*`
- Health: `/api/health`

## Security Notes

- Mobile app NEVER connects directly to SQL Server
- All DB credentials remain in backend `.env`
- JWT tokens stored securely (SecureStore in production)
- HTTP 401 handling for session expiry
- Employee password verification NOT production-secure yet (Phase 2 fix)

## Current Status: Phase 1 Complete

✅ Navigation foundation
✅ Auth stack placeholder
✅ Employee navigation (5 screens)
✅ HR navigation (8 screens)
✅ API service foundation
✅ Auth store foundation
✅ Placeholder screens with demo data
✅ Hindi comments throughout
✅ Email exclusion confirmed
✅ No SQL credentials in mobile source

## Next: Phase 2
- Real authentication implementation
- API integration with real backend
- Chart.js integration for analytics
- Excel import/export
- Push notifications
- Offline support