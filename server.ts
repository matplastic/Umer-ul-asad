import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { initializeApp as initializeAdminApp, getApps as getAdminApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import { db } from './src/db/index.ts';
import { pools, plannedPools, teams, logs, inspectors, engineers, projectsSummary, monthlyTargets, employees, trolleyProduction, recycleBin, employeePunches } from './src/db/schema.ts';
import { eq } from 'drizzle-orm';

// Initialize Firebase Admin (Static JSON import as required)
if (!getAdminApps().length) {
  initializeAdminApp({
    projectId: firebaseConfig.projectId,
  });
}
const adminAuth = getAdminAuth();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

// Middleware to verify Firebase token if present
const optionalAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    try {
      const decodedToken = await adminAuth.verifyIdToken(token);
      (req as any).user = decodedToken;
    } catch (err) {
      console.warn('Firebase ID token verification failed:', err);
    }
  }
  next();
};

app.use(optionalAuth);

// Mutating interceptor to auto-update Firestore backup in the background
app.use((req, res, next) => {
  const isMutating = ['POST', 'PUT', 'DELETE'].includes(req.method);
  const isApi = req.path.startsWith('/api/');
  const isPinCode = req.path === '/api/pins';

  if (isMutating && isApi && !isPinCode) {
    res.on('finish', () => {
      setTimeout(() => {
        backupToFirestore().catch(err => console.error('Background Firestore auto-backup failed:', err));
      }, 500);
    });
  }
  next();
});

// ----------------------------------------------------
// DURABLE CLOUD PERSISTENCE AND DISASTER RECOVERY VIA FIRESTORE
// ----------------------------------------------------

function getFirestoreDb() {
  let activeConfig = firebaseConfig;
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      activeConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading dynamic firebase configurations:', err);
  }

  // Ensure Admin App is initialized with the active projectId
  const apps = getAdminApps();
  if (!apps.length) {
    initializeAdminApp({
      projectId: activeConfig.projectId,
    });
  }

  const databaseId = activeConfig.firestoreDatabaseId;
  if (databaseId && databaseId !== '(default)') {
    return getAdminFirestore(databaseId);
  }
  return getAdminFirestore();
}

async function backupToFirestore() {
  try {
    const firestoreDb = getFirestoreDb();
    const systemStateCol = firestoreDb.collection('system_state');

    const [poolsData, plannedData, teamsData, logsData, inspectorsData, engineersData, projectsSummaryData, monthlyTargetsData, employeesData, trolleysData, recycleBinData, punchesData] = await Promise.all([
      db.select().from(pools),
      db.select().from(plannedPools),
      db.select().from(teams),
      db.select().from(logs),
      db.select().from(inspectors),
      db.select().from(engineers),
      db.select().from(projectsSummary),
      db.select().from(monthlyTargets),
      db.select().from(employees),
      db.select().from(trolleyProduction),
      db.select().from(recycleBin),
      db.select().from(employeePunches),
    ]);

    await Promise.all([
      systemStateCol.doc('pools').set({ data: poolsData }),
      systemStateCol.doc('plannedPools').set({ data: plannedData }),
      systemStateCol.doc('teams').set({ data: teamsData }),
      systemStateCol.doc('logs').set({ data: logsData }),
      systemStateCol.doc('inspectors').set({ data: inspectorsData }),
      systemStateCol.doc('engineers').set({ data: engineersData }),
      systemStateCol.doc('projectsSummary').set({ data: projectsSummaryData }),
      systemStateCol.doc('monthlyTargets').set({ data: monthlyTargetsData }),
      systemStateCol.doc('employees').set({ data: employeesData }),
      systemStateCol.doc('trolleys').set({ data: trolleysData }),
      systemStateCol.doc('recycleBin').set({ data: recycleBinData }),
      systemStateCol.doc('employeePunches').set({ data: punchesData }),
    ]);

    console.log('Successfully backed up entire active state to permanent Firestore storage.');
  } catch (err) {
    console.error('Error backing up state to Firestore:', err);
  }
}

async function restoreFromFirestore() {
  try {
    const firestoreDb = getFirestoreDb();
    const systemStateCol = firestoreDb.collection('system_state');

    const [poolsDoc, plannedDoc, teamsDoc, logsDoc, inspectorsDoc, engineersDoc, projectsSummaryDoc, monthlyTargetsDoc, employeesDoc, trolleysDoc, recycleBinDoc, punchesDoc] = await Promise.all([
      systemStateCol.doc('pools').get(),
      systemStateCol.doc('plannedPools').get(),
      systemStateCol.doc('teams').get(),
      systemStateCol.doc('logs').get(),
      systemStateCol.doc('inspectors').get(),
      systemStateCol.doc('engineers').get(),
      systemStateCol.doc('projectsSummary').get(),
      systemStateCol.doc('monthlyTargets').get(),
      systemStateCol.doc('employees').get(),
      systemStateCol.doc('trolleys').get(),
      systemStateCol.doc('recycleBin').get(),
      systemStateCol.doc('employeePunches').get(),
    ]);

    if (!poolsDoc.exists && !projectsSummaryDoc.exists) {
      console.log('No backup data found in Firestore to restore.');
      return false;
    }

    // Clear SQL database tables
    await db.delete(pools);
    await db.delete(plannedPools);
    await db.delete(teams);
    await db.delete(logs);
    await db.delete(inspectors);
    await db.delete(engineers);
    await db.delete(projectsSummary);
    await db.delete(monthlyTargets);
    await db.delete(employees);
    await db.delete(trolleyProduction);
    await db.delete(recycleBin);
    await db.delete(employeePunches);

    // Insert back restored arrays
    const poolsData = poolsDoc.exists ? (poolsDoc.data()?.data || []) : [];
    if (poolsData.length > 0) await db.insert(pools).values(poolsData);

    const plannedData = plannedDoc.exists ? (plannedDoc.data()?.data || []) : [];
    if (plannedData.length > 0) await db.insert(plannedPools).values(plannedData);

    const teamsData = teamsDoc.exists ? (teamsDoc.data()?.data || []) : [];
    if (teamsData.length > 0) await db.insert(teams).values(teamsData);

    const logsData = logsDoc.exists ? (logsDoc.data()?.data || []) : [];
    if (logsData.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < logsData.length; i += chunkSize) {
        await db.insert(logs).values(logsData.slice(i, i + chunkSize));
      }
    }

    const inspectorsData = inspectorsDoc.exists ? (inspectorsDoc.data()?.data || []) : [];
    if (inspectorsData.length > 0) await db.insert(inspectors).values(inspectorsData);

    const engineersData = engineersDoc.exists ? (engineersDoc.data()?.data || []) : [];
    if (engineersData.length > 0) await db.insert(engineers).values(engineersData);

    const projectsSummaryData = projectsSummaryDoc.exists ? (projectsSummaryDoc.data()?.data || []) : [];
    if (projectsSummaryData.length > 0) await db.insert(projectsSummary).values(projectsSummaryData);

    const monthlyTargetsData = monthlyTargetsDoc.exists ? (monthlyTargetsDoc.data()?.data || []) : [];
    if (monthlyTargetsData.length > 0) await db.insert(monthlyTargets).values(monthlyTargetsData);

    const employeesData = employeesDoc.exists ? (employeesDoc.data()?.data || []) : [];
    if (employeesData.length > 0) await db.insert(employees).values(employeesData);

    const trolleysData = trolleysDoc.exists ? (trolleysDoc.data()?.data || []) : [];
    if (trolleysData.length > 0) await db.insert(trolleyProduction).values(trolleysData);

    const recycleBinData = recycleBinDoc.exists ? (recycleBinDoc.data()?.data || []) : [];
    if (recycleBinData.length > 0) await db.insert(recycleBin).values(recycleBinData);

    const punchesData = punchesDoc.exists ? (punchesDoc.data()?.data || []) : [];
    if (punchesData.length > 0) await db.insert(employeePunches).values(punchesData);

    console.log('Successfully restored entire active state from permanent Firestore storage.');
    return true;
  } catch (err) {
    console.error('Failed to restore SQL database from Firestore:', err);
    return false;
  }
}

async function restoreDbIfEmpty() {
  try {
    const items = await db.select().from(projectsSummary).limit(1);
    if (items.length === 0) {
      console.log('PostgreSQL database is in clean/empty state (possibly container restarted). Checking Firestore permanent backup...');
      const success = await restoreFromFirestore();
      if (!success) {
        console.log('No Firestore permanent store detected or failed to restore. Running default initialization fallback.');
      }
    }
  } catch (err) {
    console.error('Error in check-and-restore DB process:', err);
  }
}

// ----------------------------------------------------
// SECURE GATE ENDPOINTS FOR CUSTOM PASSWORD/PIN CODES
// ----------------------------------------------------

app.get('/api/pins', async (req, res) => {
  try {
    const firestoreDb = getFirestoreDb();
    const pinsDoc = await firestoreDb.collection('portal_security').doc('pins').get();
    
    const defaultPins = {
      management: '1234',
      planning_department: '1111',
      production_engineer: '2222',
      quality_inspector: '3333',
      stage_worker: '4444',
      trolley_prod: '5555',
      factory_entrance: '6666',
      section_dashboard: '7777',
    };

    if (pinsDoc.exists) {
      const pinsData = pinsDoc.data();
      res.json({ ...defaultPins, ...pinsData });
    } else {
      res.json(defaultPins);
    }
  } catch (error: any) {
    console.error('Failed to retrieve security pins from Firestore:', error);
    res.json({
      management: '1234',
      planning_department: '1111',
      production_engineer: '2222',
      quality_inspector: '3333',
      stage_worker: '4444',
      trolley_prod: '5555',
      factory_entrance: '6666',
      section_dashboard: '7777',
    });
  }
});

app.post('/api/pins', async (req, res) => {
  try {
    const pinsData = req.body;
    const firestoreDb = getFirestoreDb();
    const docRef = firestoreDb.collection('portal_security').doc('pins');

    if (pinsData.role && pinsData.pin) {
      await docRef.set({ [pinsData.role]: pinsData.pin }, { merge: true });
    } else {
      await docRef.set(pinsData, { merge: true });
    }
    
    res.json({ status: 'ok', msg: 'Security access PINS updated successfully in permanent cloud storage.' });
  } catch (error: any) {
    console.error('Failed to update security pins in Firestore:', error);
    res.status(500).json({ error: 'Failed to update PIN codes in permanent storage.' });
  }
});

// ----------------------------------------------------
// FIREBASE ENVIRONMENT CREDENTIALS CONFIGURATION SERVICE
// ----------------------------------------------------

app.get('/api/firebase-config', (req, res) => {
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      res.json(JSON.parse(data));
    } else {
      res.status(404).json({ error: 'Config file not found' });
    }
  } catch (err: any) {
    console.error('Error reading firebase-applet-config.json:', err);
    res.status(500).json({ error: 'Failed to read configuration' });
  }
});

app.post('/api/firebase-config', (req, res) => {
  try {
    const newConfig = req.body;
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    
    if (!newConfig || typeof newConfig !== 'object') {
      return res.status(400).json({ error: 'Invalid configuration payload' });
    }
    
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');
    res.json({ status: 'ok', msg: 'Firebase credentials written successfully to permanent runtime config.' });
  } catch (err: any) {
    console.error('Error writing firebase-applet-config.json:', err);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

app.post('/api/firebase-config/backup', async (req, res) => {
  try {
    await backupToFirestore();
    res.json({ status: 'ok', msg: 'Manual backup to Firestore completed successfully.' });
  } catch (err: any) {
    console.error('Manual Firestore backup failed:', err);
    res.status(500).json({ error: 'Manual backup failed: ' + err.message });
  }
});

app.post('/api/firebase-config/restore', async (req, res) => {
  try {
    const success = await restoreFromFirestore();
    if (success) {
      res.json({ status: 'ok', msg: 'Complete active state successfully updated and restored from Firestore backup!' });
    } else {
      res.status(400).json({ error: 'Failed to restore state. No valid backup document found in Firestore.' });
    }
  } catch (err: any) {
    console.error('Manual Firestore restore failed:', err);
    res.status(500).json({ error: 'Manual state restore failed: ' + err.message });
  }
});

// API Endpoints: state loaders and updates

// 1. Get entire state from PostgreSQL
app.get('/api/state', async (req, res) => {
  try {
    await restoreDbIfEmpty();
    const [poolsData, plannedData, teamsData, logsData, inspectorsData, engineersData, projectsSummaryData, monthlyTargetsData, employeesData, trolleysData, recycleBinData, punchesData] = await Promise.all([
      db.select().from(pools),
      db.select().from(plannedPools),
      db.select().from(teams),
      db.select().from(logs),
      db.select().from(inspectors),
      db.select().from(engineers),
      db.select().from(projectsSummary),
      db.select().from(monthlyTargets),
      db.select().from(employees),
      db.select().from(trolleyProduction),
      db.select().from(recycleBin),
      db.select().from(employeePunches),
    ]);

    res.json({
      pools: poolsData,
      plannedPools: plannedData,
      teams: teamsData,
      logs: logsData,
      inspectors: inspectorsData,
      engineers: engineersData,
      projectsSummary: projectsSummaryData,
      monthlyTargets: monthlyTargetsData,
      employees: employeesData,
      trolleys: trolleysData,
      recycleBin: recycleBinData,
      employeePunches: punchesData,
    });
  } catch (error: any) {
    console.error('Failed to load SQL state:', error);
    res.status(500).json({ error: 'Failed to retrieve state from Cloud SQL.' });
  }
});

// 2. Full deep reset/seeding of database
app.post('/api/state/reset', async (req, res) => {
  try {
    const { 
      pools: newPools, 
      plannedPools: newPlanners, 
      teams: newTeams, 
      logs: newLogs, 
      inspectors: newInspectors, 
      engineers: newEngineers,
      projectsSummary: newProjectsSummary,
      monthlyTargets: newMonthlyTargets,
      employees: newEmployees
    } = req.body;

    // We execute inside try block to handle clean cascading structure
    await db.delete(pools);
    await db.delete(plannedPools);
    await db.delete(teams);
    await db.delete(logs);
    await db.delete(inspectors);
    await db.delete(engineers);
    await db.delete(projectsSummary);
    await db.delete(monthlyTargets);
    await db.delete(employees);

    if (newPools && newPools.length > 0) {
      await db.insert(pools).values(newPools);
    }
    if (newPlanners && newPlanners.length > 0) {
      await db.insert(plannedPools).values(newPlanners);
    }
    if (newTeams && newTeams.length > 0) {
      await db.insert(teams).values(newTeams);
    }
    if (newLogs && newLogs.length > 0) {
      // Postgres limit of parameters. Chunk logs if too long.
      const chunkedLogs = [];
      const chunkSize = 100;
      for (let i = 0; i < newLogs.length; i += chunkSize) {
        chunkedLogs.push(newLogs.slice(i, i + chunkSize));
      }
      for (const chunk of chunkedLogs) {
        await db.insert(logs).values(chunk);
      }
    }
    if (newInspectors && newInspectors.length > 0) {
      await db.insert(inspectors).values(newInspectors);
    }
    if (newEngineers && newEngineers.length > 0) {
      await db.insert(engineers).values(newEngineers);
    }
    if (newProjectsSummary && newProjectsSummary.length > 0) {
      await db.insert(projectsSummary).values(newProjectsSummary);
    }
    if (newMonthlyTargets && newMonthlyTargets.length > 0) {
      await db.insert(monthlyTargets).values(newMonthlyTargets);
    }
    if (newEmployees && newEmployees.length > 0) {
      await db.insert(employees).values(newEmployees);
    }

    await backupToFirestore();
    res.json({ status: 'ok', msg: 'Cloud SQL database synchronized and updated successfully!' });
  } catch (error: any) {
    console.error('Failed to reset and seed SQL database:', error);
    res.status(500).json({ error: 'Failed to reset and seed Cloud SQL.' });
  }
});

// 3. Single pools CRUD
app.post('/api/pools', async (req, res) => {
  try {
    const poolData = req.body;
    await db.insert(pools).values(poolData).onConflictDoUpdate({
      target: pools.id,
      set: poolData,
    });
    res.json({ status: 'ok', pool: poolData });
  } catch (error: any) {
    console.error('Failed to save Pool:', error);
    res.status(500).json({ error: 'Database failed to save Pool record.' });
  }
});

app.delete('/api/pools/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(pools).where(eq(pools.id, id));
    res.json({ status: 'ok' });
  } catch (error: any) {
    console.error('Failed to delete Pool:', error);
    res.status(500).json({ error: 'Database failed to delete Pool record.' });
  }
});

// 4. Planned pools CRUD
app.post('/api/planned-pools', async (req, res) => {
  try {
    const plannerData = req.body;
    await db.insert(plannedPools).values(plannerData).onConflictDoUpdate({
      target: plannedPools.id,
      set: plannerData,
    });
    res.json({ status: 'ok', plannedPool: plannerData });
  } catch (error: any) {
    console.error('Failed to save planned pool:', error);
    res.status(500).json({ error: 'Database failed to save planned pool.' });
  }
});

app.delete('/api/planned-pools/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(plannedPools).where(eq(plannedPools.id, id));
    res.json({ status: 'ok' });
  } catch (error: any) {
    console.error('Failed to delete Planned Pool:', error);
    res.status(500).json({ error: 'Database failed to delete planned pool record.' });
  }
});

// 5. Teams CRUD
app.post('/api/teams', async (req, res) => {
  try {
    const teamData = req.body;
    await db.insert(teams).values(teamData).onConflictDoUpdate({
      target: teams.id,
      set: teamData,
    });
    res.json({ status: 'ok', team: teamData });
  } catch (error: any) {
    console.error('Failed to save Team:', error);
    res.status(500).json({ error: 'Database failed to save Team record.' });
  }
});

// 6. Activity logs CRUD
app.post('/api/logs', async (req, res) => {
  try {
    const logData = req.body;
    await db.insert(logs).values(logData).onConflictDoUpdate({
      target: logs.id,
      set: logData,
    });
    res.json({ status: 'ok', log: logData });
  } catch (error: any) {
    console.error('Failed to save log:', error);
    res.status(500).json({ error: 'Database failed to save Audit Log.' });
  }
});

// 7. Projects summary CRUD
app.post('/api/projects-summary', async (req, res) => {
  try {
    const data = req.body;
    await db.insert(projectsSummary).values(data).onConflictDoUpdate({
      target: projectsSummary.id,
      set: data,
    });
    res.json({ status: 'ok', projectSummary: data });
  } catch (error: any) {
    console.error('Failed to save project summary:', error);
    res.status(500).json({ error: 'Database failed to save Project Summary.' });
  }
});

app.delete('/api/projects-summary/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(projectsSummary).where(eq(projectsSummary.id, id));
    res.json({ status: 'ok' });
  } catch (error: any) {
    console.error('Failed to delete Project Summary:', error);
    res.status(500).json({ error: 'Database failed to delete Project Summary.' });
  }
});

// 8. Monthly targets CRUD
app.post('/api/monthly-targets', async (req, res) => {
  try {
    const data = req.body;
    await db.insert(monthlyTargets).values(data).onConflictDoUpdate({
      target: monthlyTargets.id,
      set: data,
    });
    res.json({ status: 'ok', monthlyTarget: data });
  } catch (error: any) {
    console.error('Failed to save monthly target:', error);
    res.status(500).json({ error: 'Database failed to save Monthly Target.' });
  }
});

app.delete('/api/monthly-targets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(monthlyTargets).where(eq(monthlyTargets.id, id));
    res.json({ status: 'ok' });
  } catch (error: any) {
    console.error('Database failed to delete Monthly Target:', error);
    res.status(500).json({ error: 'Database failed to delete Monthly Target.' });
  }
});

// 9. Employees CRUD
app.post('/api/employees', async (req, res) => {
  try {
    const data = req.body;
    await db.insert(employees).values(data).onConflictDoUpdate({
      target: employees.id,
      set: data,
    });
    res.json({ status: 'ok', employee: data });
  } catch (error: any) {
    console.error('Database failed to save employee:', error);
    res.status(500).json({ error: 'Database failed to save Employee.' });
  }
});

app.delete('/api/employees/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(employees).where(eq(employees.id, id));
    res.json({ status: 'ok' });
  } catch (error: any) {
    console.error('Database failed to delete employee:', error);
    res.status(500).json({ error: 'Database failed to delete Employee.' });
  }
});

// 10. Trolley Production CRUD
app.post('/api/trolley-production', async (req, res) => {
  try {
    const data = req.body;
    await db.insert(trolleyProduction).values(data).onConflictDoUpdate({
      target: trolleyProduction.id,
      set: data,
    });
    res.json({ status: 'ok', trolley: data });
  } catch (error: any) {
    console.error('Database failed to save trolley production:', error);
    res.status(500).json({ error: 'Database failed to save Trolley Production.' });
  }
});

app.delete('/api/trolley-production/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(trolleyProduction).where(eq(trolleyProduction.id, id));
    res.json({ status: 'ok' });
  } catch (error: any) {
    console.error('Database failed to delete trolley production:', error);
    res.status(500).json({ error: 'Database failed to delete Trolley Production.' });
  }
});

// 11. Recycle Bin endpoints
app.post('/api/recycle-bin', async (req, res) => {
  try {
    const data = req.body; // { id, dataType, deletedAt, payload }
    await db.insert(recycleBin).values(data);
    res.json({ status: 'ok', recycleItem: data });
  } catch (error: any) {
    console.error('Failed to add to recycle bin:', error);
    res.status(500).json({ error: 'Failed to add item to recycle bin.' });
  }
});

app.delete('/api/recycle-bin/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(recycleBin).where(eq(recycleBin.id, id));
    res.json({ status: 'ok' });
  } catch (error: any) {
    console.error('Failed to delete from recycle bin:', error);
    res.status(500).json({ error: 'Failed to remove from recycle bin.' });
  }
});

app.post('/api/recycle-bin/restore/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [item] = await db.select().from(recycleBin).where(eq(recycleBin.id, id));
    if (!item) {
      return res.status(404).json({ error: 'Item not found in Recycle Bin.' });
    }

    const payload = item.payload as any;

    if (item.dataType === 'all_pools_data') {
      // Re-insert list of pools, plannedPools, and projectsSummary
      if (payload.pools && payload.pools.length > 0) {
        await db.insert(pools).values(payload.pools).onConflictDoNothing();
      }
      if (payload.plannedPools && payload.plannedPools.length > 0) {
        await db.insert(plannedPools).values(payload.plannedPools).onConflictDoNothing();
      }
      if (payload.projectsSummary && payload.projectsSummary.length > 0) {
        await db.insert(projectsSummary).values(payload.projectsSummary).onConflictDoNothing();
      }
    } else if (item.dataType === 'trolley') {
      if (payload.trolley) {
        await db.insert(trolleyProduction).values(payload.trolley).onConflictDoNothing();
      } else if (Array.isArray(payload)) {
        await db.insert(trolleyProduction).values(payload).onConflictDoNothing();
      }
    } else if (item.dataType === 'pool') {
      await db.insert(pools).values(payload).onConflictDoNothing();
    } else if (item.dataType === 'planned_pool') {
      await db.insert(plannedPools).values(payload).onConflictDoNothing();
    } else if (item.dataType === 'project_summary') {
      await db.insert(projectsSummary).values(payload).onConflictDoNothing();
    }

    // Now delete it from the recycle bin
    await db.delete(recycleBin).where(eq(recycleBin.id, id));

    res.json({ status: 'ok', msg: 'Item restored successfully!' });
  } catch (error: any) {
    console.error('Failed to restore from recycle bin:', error);
    res.status(500).json({ error: 'Failed to restore item: ' + error.message });
  }
});

// Endpoint to delete all pool-related data specifically but keep teams and employees
app.post('/api/state/purge-pools', async (req, res) => {
  try {
    const { backupId } = req.body;

    // Fetch existing pool-related data to back it up in the Recycle Bin before deleting!
    const [poolsList, plannedPoolsList, projectsSummaryList] = await Promise.all([
      db.select().from(pools),
      db.select().from(plannedPools),
      db.select().from(projectsSummary),
    ]);

    const backupRecord = {
      id: backupId || `backup_all_pools_${Date.now()}`,
      dataType: 'all_pools_data',
      deletedAt: new Date().toISOString(),
      payload: {
        pools: poolsList,
        plannedPools: plannedPoolsList,
        projectsSummary: projectsSummaryList,
      }
    };

    // Store in recycle bin
    await db.insert(recycleBin).values(backupRecord);

    // Delete existing records
    await db.delete(pools);
    await db.delete(plannedPools);
    await db.delete(projectsSummary);

    res.json({ status: 'ok', msg: 'Secondary pool tables purged successfully and archived to Recycle Bin.' });
  } catch (error: any) {
    console.error('Failed to purge pool related data:', error);
    res.status(500).json({ error: 'Failed to purge pool related records: ' + error.message });
  }
});

// 12. Employee Punches CRUD
app.post('/api/employee-punches', async (req, res) => {
  try {
    const data = req.body;
    await db.insert(employeePunches).values(data).onConflictDoUpdate({
      target: employeePunches.id,
      set: data,
    });
    res.json({ status: 'ok', punch: data });
  } catch (error: any) {
    console.error('Database failed to save employee punch:', error);
    res.status(500).json({ error: 'Database failed to save Punch.' });
  }
});

app.delete('/api/employee-punches/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(employeePunches).where(eq(employeePunches.id, id));
    res.json({ status: 'ok' });
  } catch (error: any) {
    console.error('Database failed to delete employee punch:', error);
    res.status(500).json({ error: 'Database failed to delete Punch.' });
  }
});

// Delete all punches for a specific date
app.post('/api/employee-punches/delete-by-date', async (req, res) => {
  try {
    const { date } = req.body;
    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }
    await db.delete(employeePunches).where(eq(employeePunches.date, date));
    res.json({ status: 'ok', msg: `Successfully cleared all attendance records for ${date}` });
  } catch (error: any) {
    console.error('Database failed to delete punches by date:', error);
    res.status(500).json({ error: 'Database failed to delete punches: ' + error.message });
  }
});

// Clear all attendance punches completely
app.post('/api/employee-punches/clear-all', async (req, res) => {
  try {
    await db.delete(employeePunches);
    res.json({ status: 'ok', msg: 'All employee attendance logs successfully wiped' });
  } catch (error: any) {
    console.error('Database failed to clear all punches:', error);
    res.status(500).json({ error: 'Database failed to clear all punches: ' + error.message });
  }
});

// Direct Bio Cloud Automated Pull Gateway
app.post('/api/biocloud/sync', async (req, res) => {
  try {
    const { url, apiKey, date, autoRegisterNew } = req.body;
    if (!date) {
      return res.status(400).json({ error: 'Target Sync Date is required' });
    }

    let records: any[] = [];
    let logLines: string[] = [];

    logLines.push(`[${new Date().toLocaleTimeString()}] Contacting Bio Cloud software connector...`);
    logLines.push(`[${new Date().toLocaleTimeString()}] Target sync date: ${date}`);

    // If no URL is provided or it is specified as a demo simulation, return beautiful simulated machine logs
    if (!url || url.includes('simulate') || url.trim() === '') {
      logLines.push(`[${new Date().toLocaleTimeString()}] No official external Bio Cloud server configured. Running internal sandbox sync simulation wrapper...`);
      logLines.push(`[${new Date().toLocaleTimeString()}] Fetching Bio Cloud Terminal device ID "Device_2"...`);
      
      // We will pull active employee list from db to make the demonstration feel 100% genuine and seamless
      const activeEmployees = await db.select().from(employees);
      logLines.push(`[${new Date().toLocaleTimeString()}] Found ${activeEmployees.length} registered workstations on network.`);
      
      // Create some realistic punches for them on this date
      activeEmployees.slice(0, 5).forEach((emp, i) => {
        // IN punch
        const checkInHour = 6 + Math.floor(Math.random() * 2);
        const checkInMin = Math.floor(Math.random() * 60).toString().padStart(2, '0');
        const inStr = `${checkInHour.toString().padStart(2, '0')}:${checkInMin}`;
        
        let dIn = new Date(date);
        dIn.setHours(checkInHour, parseInt(checkInMin), 0, 0);

        records.push({
          id: `biocloud_sync_${emp.id}_IN_${Date.now()}_${i}`,
          employeeId: emp.id,
          employeeName: emp.name,
          punchType: 'IN',
          timestamp: dIn.toISOString(),
          machineId: 'Device_2_Cloud',
          date: date
        });

        // OUT punch
        const checkOutHour = 15 + Math.floor(Math.random() * 3);
        const checkOutMin = Math.floor(Math.random() * 60).toString().padStart(2, '0');
        const outStr = `${checkOutHour.toString().padStart(2, '0')}:${checkOutMin}`;
        
        let dOut = new Date(date);
        dOut.setHours(checkOutHour, parseInt(checkOutMin), 0, 0);

        records.push({
          id: `biocloud_sync_${emp.id}_OUT_${Date.now()}_${i}`,
          employeeId: emp.id,
          employeeName: emp.name,
          punchType: 'OUT',
          timestamp: dOut.toISOString(),
          machineId: 'Device_2_Cloud',
          date: date
        });
        
        logLines.push(`[${new Date().toLocaleTimeString()}] Received check-in record for worker ${emp.name} (ID: ${emp.id}): IN @ ${inStr}, OUT @ ${outStr}`);
      });
    } else {
      // Direct Real Integration connection!
      logLines.push(`[${new Date().toLocaleTimeString()}] Initiating REST query to raw endpoint: ${url}`);
      logLines.push(`[${new Date().toLocaleTimeString()}] Authorization payload size: ${apiKey ? apiKey.length : 0} bytes`);

      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
      }

      const externalResponse = await fetch(`${url}?date=${date}`, {
        method: 'GET',
        headers
      });

      if (!externalResponse.ok) {
        throw new Error(`External Bio Cloud API returned status ${externalResponse.status}: ${externalResponse.statusText}`);
      }

      const parsedJSON = await externalResponse.json();
      logLines.push(`[${new Date().toLocaleTimeString()}] Connection established! Received payload successfully parsed as JSON.`);

      // Format could be an array of records
      const rawRecords = Array.isArray(parsedJSON) ? parsedJSON : (parsedJSON.data || parsedJSON.records || []);
      logLines.push(`[${new Date().toLocaleTimeString()}] Found ${rawRecords.length} punch rows in JSON body.`);

      // Map dynamic fields to our DB layout
      rawRecords.forEach((item: any, idx: number) => {
        const empId = String(item.BadgeNumber || item.badgeNumber || item.employeeId || item.id || '');
        const empName = String(item.EmployeeName || item.employeeName || item.name || 'Cloud Worker');
        const pType = String(item.punchType || item.PunchType || (item.checkIn ? 'IN' : item.checkOut ? 'OUT' : 'IN')).toUpperCase();
        const pTime = item.timestamp || item.Timestamp || item.time || new Date().toISOString();
        const mId = item.machineId || item.MachineId || item.device || 'BioCloud_Terminal';

        if (empId) {
          records.push({
            id: `biocloud_api_${empId}_${pType}_${idx}_${Date.now()}`,
            employeeId: empId,
            employeeName: empName,
            punchType: pType === 'OUT' ? 'OUT' : 'IN',
            timestamp: pTime,
            machineId: mId,
            date: date
          });
          logLines.push(`[${new Date().toLocaleTimeString()}] Registered online row: ${empName} (${empId}) -> ${pType}`);
        }
      });
    }

    // Save records to our DB
    let syncedCount = 0;
    for (const rec of records) {
      await db.insert(employeePunches).values(rec).onConflictDoUpdate({
        target: employeePunches.id,
        set: rec,
      });
      syncedCount++;
    }

    logLines.push(`[${new Date().toLocaleTimeString()}] Sync complete. Parsed and upserted ${syncedCount} punch instances to PostgreSQL.`);
    res.json({
      status: 'ok',
      records,
      logLines,
      syncedCount
    });

  } catch (error: any) {
    console.error('Bio Cloud Live Sync Failure:', error);
    res.status(500).json({
      status: 'error',
      error: error.message,
      logLines: [
        `[${new Date().toLocaleTimeString()}] SYNC FAILED!`,
        `[${new Date().toLocaleTimeString()}] Root error reason: ${error.message}`
      ]
    });
  }
});

// Bulk Import endpoints
app.post('/api/employee-punches/bulk', async (req, res) => {
  try {
    const dataArray = req.body;
    if (!Array.isArray(dataArray)) {
      return res.status(400).json({ error: 'Body must be an array' });
    }
    if (dataArray.length === 0) {
      return res.json({ status: 'ok', inserted: 0 });
    }
    for (const item of dataArray) {
      await db.insert(employeePunches).values(item).onConflictDoUpdate({
        target: employeePunches.id,
        set: item,
      });
    }
    res.json({ status: 'ok', inserted: dataArray.length });
  } catch (error: any) {
    console.error('Database failed to bulk save employee punches:', error);
    res.status(500).json({ error: 'Database failed to bulk save punches: ' + error.message });
  }
});

app.post('/api/employees/bulk', async (req, res) => {
  try {
    const dataArray = req.body;
    if (!Array.isArray(dataArray)) {
      return res.status(400).json({ error: 'Body must be an array' });
    }
    if (dataArray.length === 0) {
      return res.json({ status: 'ok', inserted: 0 });
    }
    for (const item of dataArray) {
      await db.insert(employees).values(item).onConflictDoUpdate({
        target: employees.id,
        set: item,
      });
    }
    res.json({ status: 'ok', inserted: dataArray.length });
  } catch (error: any) {
    console.error('Database failed to bulk save employees:', error);
    res.status(500).json({ error: 'Database failed to bulk save employees: ' + error.message });
  }
});



// Mount Vite middleware for development vs serve built files in production
async function setupViteOrStatic() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Vite middleware coupled for development.');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('Serving production build assets from /dist.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Production-ready Express server running on port ${PORT}`);
  });
}

setupViteOrStatic().catch((err) => {
  console.error('Vite dev server initialization crash:', err);
});
