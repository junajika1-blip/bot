// index.js - RnBNET WEB DASHBOARD (Queue System FIXED)
const path = require('path');
const express = require('express');
const RouterOSAPI = require('node-routeros').RouterOSAPI;
const config = require('./config');
const { scanSemuaOlt } = require('./oltService');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(` WEB DASHBOARD RUNNING ON PORT ${PORT}`));

// Helper Timeout
function withTimeout(promise, ms, errMsg) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(errMsg)), ms);
    });
    return Promise.race([promise.finally(() => clearTimeout(timeoutId)), timeoutPromise]);
}

async function connectMikrotik(serverKey) {
    const targetServer = config.servers[serverKey];
    if (!targetServer) throw new Error(`Server "${serverKey}" tidak ditemukan`);
    const api = new RouterOSAPI({
        host: targetServer.mikrotik.host,
        port: targetServer.mikrotik.port,
        user: targetServer.mikrotik.user,
        password: targetServer.mikrotik.pass,
        timeout: 15
    });
    try {
        await withTimeout(api.connect(), 15000, `Timeout koneksi ke MikroTik ${targetServer.label}.`);
        return { api, targetServer };
    } catch (err) {
        safeCloseMikrotik(api).catch(() => {});
        throw new Error(`Gagal konek MikroTik ${targetServer.label}. Cek port API atau network.`);
    }
}

async function getUserFromMikrotik(api, username) {
    let secrets = await withTimeout(api.write('/ppp/secret/print', [`?name=${username}`]), 25000, 'Timeout Query Secret.');
    let userObj = secrets.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());
    if (userObj) return userObj;
    secrets = await withTimeout(api.write('/ppp/secret/print'), 25000, 'Timeout Query Secret Full Scan.');
    userObj = secrets.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());
    if (!userObj) throw new Error(`User "${username}" tidak ditemukan`);
    return userObj;
}

async function getActiveUserFromMikrotik(api, username) {
    let activeUsers = await withTimeout(api.write('/ppp/active/print', [`?name=${username}`]), 25000, 'Timeout Query Active.');
    let found = activeUsers.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());
    if (found) return found;
    activeUsers = await withTimeout(api.write('/ppp/active/print'), 25000, 'Timeout Query Active Full Scan.');
    return activeUsers.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());
}

async function safeCloseMikrotik(api) {
    if (!api) return;
    try { await withTimeout(api.close(), 5000, 'Close timeout'); } catch (e) {}
}

// ==========================================
// QUEUE SYSTEM (DIPERBAIKI)
// ==========================================
const requestQueue = [];
let isProcessingQueue = false;

async function enqueueTask(taskFn, username, serverLabel) {
    // Jika sedang ada yang proses, masuk antrian
    if (isProcessingQueue) {
        const position = requestQueue.length + 1;
        requestQueue.push({
            execute: async () => {
                try {
                    await taskFn();
                    console.log(`✅ [ANTRIAN SELESAI] ${username} (${serverLabel})`);
                } catch (err) {
                    console.error(`❌ [ANTRIAN GAGAL] ${username}: ${err.message}`);
                }
            },
            username, 
            server: serverLabel
        });
        console.log(`📋 [ANTRIAN] ${username} (${serverLabel}) masuk antrian posisi #${position}`);
        return { 
            queued: true, 
            position, 
            estimatedWait: position * 90 
        };
    } 
    // Jika tidak ada antrian, proses LANGSUNG dan TUNGGU sampai selesai
    else {
        isProcessingQueue = true;
        console.log(`▶️ [PROSES] ${username} (${serverLabel}) sedang diproses`);
        try {
            const result = await taskFn();
            return { success: true, data: result };
        } catch (err) {
            return { success: false, error: err.message };
        } finally {
            processNextInQueue();
        }
    }
}

async function processNextInQueue() {
    if (requestQueue.length > 0) {
        const next = requestQueue.shift();
        console.log(`▶️ [PROSES] ${next.username} (${next.server}) dari antrian #1`);
        await next.execute();
        processNextInQueue();
    } else {
        isProcessingQueue = false;
        console.log(`✅ [SELESAI] Antrian kosong`);
    }
}

// API: Daftar Server
app.get('/api/servers', (req, res) => {
    const servers = Object.keys(config.servers).map(key => ({ key, label: config.servers[key].label }));
    res.json({ servers });
});

// API: Cek Status Antrian
app.get('/api/queue-status', (req, res) => {
    const currentProcessing = requestQueue.length > 0 ? requestQueue[0] : null;
    res.json({
        queueLength: requestQueue.length,
        isProcessing: isProcessingQueue,
        currentProcessing: currentProcessing ? { username: currentProcessing.username, server: currentProcessing.server } : null
    });
});

// API: Cek Redaman
app.post('/api/cek-redaman', async (req, res) => {
    const { serverKey, username } = req.body;
    if (!serverKey || !username) return res.status(400).json({ error: 'Server dan username wajib diisi' });
    
    let api;
    const result = await enqueueTask(async () => {
        const { api: mikrotikApi, targetServer } = await connectMikrotik(serverKey);
        api = mikrotikApi;
        const userObj = await getUserFromMikrotik(api, username);
        let rawMac = userObj['caller-id'] || 'Any';
        const activeUser = await getActiveUserFromMikrotik(api, username);
        if (activeUser) rawMac = activeUser['caller-id'] || rawMac;
        if (!rawMac || rawMac === 'Any') throw new Error('MAC Address tidak terbaca untuk user ini');
        const mac = rawMac.trim().toLowerCase();
        let oltText = 'ONU tidak ditemukan di OLT manapun';
        await scanSemuaOlt(targetServer.olts, mac, async (teksHasil) => { oltText = teksHasil; });
        return { username, server: targetServer.label, mac, olt: oltText };
    }, username, config.servers[serverKey]?.label || 'Unknown');
    
    await safeCloseMikrotik(api);
    res.json(result);
});

// API: Aktivasi
app.post('/api/aktivasi', async (req, res) => {
    const { serverKey, username } = req.body;
    if (!serverKey || !username) return res.status(400).json({ error: 'Server dan username wajib diisi' });
    
    let api;
    const result = await enqueueTask(async () => {
        const { api: mikrotikApi, targetServer } = await connectMikrotik(serverKey);
        api = mikrotikApi;
        const userObj = await getUserFromMikrotik(api, username);
        await withTimeout(api.write(['/ppp/secret/set', `=.id=${userObj['.id']}`, '=disabled=no']), 15000, 'Timeout set disabled=no');
        await new Promise(r => setTimeout(r, 2000));
        const activeUser = await getActiveUserFromMikrotik(api, username);
        let ip = userObj['remote-address'] || 'Dynamic';
        let rawMac = userObj['caller-id'] || 'Any';
        const paket = userObj.profile || 'default';
        if (activeUser) { ip = activeUser.address || ip; rawMac = activeUser['caller-id'] || rawMac; }
        const response = { username, server: targetServer.label, paket, ip, mac: rawMac, status: 'BERHASIL', olt: null };
        if (rawMac && rawMac !== 'Any') {
            const mac = rawMac.trim().toLowerCase(); response.mac = mac;
            let oltText = 'ONU tidak ditemukan di OLT manapun';
            await scanSemuaOlt(targetServer.olts, mac, async (teksHasil) => { oltText = teksHasil; });
            response.olt = oltText;
        }
        return response;
    }, username, config.servers[serverKey]?.label || 'Unknown');
    
    await safeCloseMikrotik(api);
    res.json(result);
});

process.on('unhandledRejection', err => console.error(' UNHANDLED:', err));
process.on('uncaughtException', err => { if (err.name === 'RosException' && err.message.includes('Timed out')) return; console.error('❌ UNCAUGHT:', err); });
