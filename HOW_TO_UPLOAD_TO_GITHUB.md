# 📤 How to Upload These Files to Your GitHub Repo
**Repo:** `https://github.com/matplastic/Umer-ul-asad`

## ⚠️ BEFORE YOU UPLOAD — One critical step

Open `package.json` in your repo and confirm these 4 dependencies are added under `"dependencies"`:

```json
"jspdf": "^2.5.2",
"jspdf-autotable": "^3.8.4",
"qrcode.react": "^4.2.0",
"html5-qrcode": "^2.3.8",
```

If they're missing, just add those 4 lines. Netlify will install them on next deploy.

---

## 🟢 Option A — GitHub Web (no terminal, easiest)

### Step 1: Open your repo
Go to: **https://github.com/matplastic/Umer-ul-asad**

### Step 2: Update each file, one at a time

For each file in the table below:
1. Click the file in GitHub (navigate to the path shown)
2. Click the **✏️ pencil icon** (top-right of the file view) to edit
3. **Select ALL existing content** (Ctrl+A / Cmd+A) and **delete it**
4. Open the corresponding file from this preview (`/app/FIXED_...` or `/app/NEW_...`), **copy all of it**, and paste into the GitHub editor
5. Scroll down → **"Commit changes"** → green button

### Step 3: Files to update / create

| GitHub path in your repo | Paste content from |
|---|---|
| `src/App.tsx` | `/app/FIXED_App.tsx` |
| `src/types.ts` | `/app/FIXED_types.ts` |
| `src/components/RoleSelector.tsx` | `/app/FIXED_RoleSelector.tsx` |
| `src/components/PlanningDepartment.tsx` | `/app/FIXED_PlanningDepartment.tsx` |
| `src/components/QualityInspector.tsx` | `/app/FIXED_QualityInspector.tsx` |
| `src/components/ProductionEngineer.tsx` | `/app/FIXED_ProductionEngineer.tsx` |
| `src/components/ManagementDashboard.tsx` | `/app/FIXED_ManagementDashboard.tsx` |
| `src/lib/firebaseService.ts` | `/app/FIXED_firebaseService.ts` |

### Step 4: Create NEW files (3 of them)

These files DON'T exist yet — you need to create them.

For each:
1. In GitHub, navigate to the folder shown
2. Click **"Add file"** dropdown → **"+ Create new file"**
3. Type the filename (exact, with extension)
4. Paste the full content from the source path below
5. Click **"Commit new file"**

| Create at this path | Paste content from |
|---|---|
| `src/lib/exportUtils.ts` | `/app/NEW_exportUtils.ts` |
| `src/components/QRCodeModule.tsx` | `/app/NEW_QRCodeModule.tsx` |
| `src/components/ReportsAndAnalytics.tsx` | `/app/NEW_ReportsAndAnalytics.tsx` |

### Step 5: Update package.json (if not already done)

In GitHub, edit `package.json` → add the 4 packages from the top of this guide → commit.

### Step 6: Wait for Netlify to redeploy
Netlify auto-rebuilds on every push (usually 2-3 minutes). Watch your Netlify dashboard for green ✓.

---

## 🟢 Option B — Apply the unified patch (if you have terminal + git)

If you DO have a local copy of the repo on your computer:

```bash
cd path/to/Umer-ul-asad
git pull origin main
git apply /path/to/umer-fix-v4.patch
yarn install
git add -A
git commit -m "feat: Reports & Analytics + QR codes + data-loss fix"
git push origin main
```

The patch is at `/app/umer-fix-v4.patch`.

---

## ✅ After deploy — How to verify

1. **Hard-refresh** every device (Ctrl+Shift+R / Cmd+Shift+R) — important so old tabs pick up the new data-loss fix.
2. **Your existing data should appear as-is** in every dashboard. Nothing got wiped.
3. **New "Reports & Analytics" portal** should appear in the role switcher (top header).
4. **Floating QR camera button** in the bottom-right of every screen.
5. **New "👷 Roles" tab** in the Planning portal — manage real inspectors/engineers here.

## 🧹 One-time cleanup of OLD demo records still in Firestore

After deploy, use the **new Delete buttons** to clean up records that were seeded by previous app versions:

| Old demo record | Where to delete it |
|---|---|
| Insp. Sarah Wells / Mike Vance / David Cole | Planning Portal → 👷 **Roles** tab → 🗑️ each |
| Eng. Karim R. / Eng. Fatima S. | Planning Portal → 👷 **Roles** tab → 🗑️ each |
| Tiger / Panther Elite project | Planning Portal → **All Projects Portal** → 🗑️ each |
| June 2026 demo target | Planning Portal → **KPI Targets Scheduler** → ❌ on each pill |
| John Doe / Alba Vance employees | **HR Management Portal** → 🗑️ each |
| Old demo pools (if any) | Planning Portal → **Direct Stage & Status Updater** → select pool → 🗑️ Delete |

Each deletion is permanent in Firestore + saved to Recycle Bin (3-day undo window).

---

## 🆘 If something goes wrong

- **Build fails on Netlify** → check that the 4 packages were added to `package.json`
- **"Reports & Analytics" missing from header** → Hard-refresh browser
- **Charts show no data** → That's expected if Firestore is empty. Add some pools and refresh.
- **Old demo data still showing** → Use the Delete buttons (see table above). The code won't recreate them.
- **Want to revert** → All your changes are commits in GitHub. Click any previous commit → "Revert".

## 📞 Need help?
Tell me exactly which file you're stuck on and I'll give you the exact lines to copy.
