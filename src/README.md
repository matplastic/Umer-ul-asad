# MAT Plastic ERP System

An internal web-based Manufacturing ERP application for MAT Plastic Industries LLC (UAE swimming pool manufacturer — steel fabrication, steel coating, GRP/fibreglass, mosaic, and acrylic production).

## Overview

This system manages the full production and operations workflow, including:

- Material request workflow with cart-based batching, manager approval/rejection via email (Resend) and WhatsApp (Twilio), and per-item approve/reject decisions
- Inventory and store management, including searchable material lookup, stock validation, and Floor Stock tracking
- Production stage tracking across manufacturing boards, with parallel-stage gating (e.g. Skimmer Fitting / Lamination)
- HR Management Portal (employee directory, attendance, payroll, leave, warnings, accident reports, medical records)
- QC defect tracking with real-time propagation across stage floor, management, and planning views
- Worker PIN-pad login for Stage Floor portals
- Automated Google Drive backups

## Tech Stack

- **Frontend:** React + TypeScript, built with Vite
- **Backend / Data:** Firebase (Firestore)
- **Hosting:** Netlify
- **Notifications:** Resend (email), Twilio (WhatsApp)

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Configure your Firebase project credentials (see `firebase-applet-config.json` and `firestore.rules`)
3. Run the app:
   `npm run dev`

## Deployment

Deployed via Netlify (see `netlify.toml`).
