// oltService.js - PERBAIKAN: Login Hioso 8Pon + Respon Lebih Cepat
const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

// ==========================================
// 1. HSAirpo API (Panglejar & Sukamelang)
// ==========================================
async function cekRedamanHSAirpoAPI(oltConfig, mac) {
    console.log(`\n🔍 [${oltConfig.label}] Mulai cek (API)...`);
    try {
        const searchMac = mac.substring(0, 16);
        console.log(`MAC dicari: ${searchMac}`);
        const username = oltConfig.user || 'root';
        const password = oltConfig.pass || 'admin';
        const key = crypto.createHash('md5').update(`${username}:${password}`).digest('hex');
        const value = Buffer.from(password).toString('base64');
        const loginRes = await axios.post(
            `http://${oltConfig.ip}:${oltConfig.port}/userlogin?form=login`,
            { method: "set", param: { name: username, key, value, captcha_v: " ", captcha_f: " " } },
            { headers: { 'Content-Type': 'application/json;charset=UTF-8', 'x-token': 'null' }, timeout: 8000 }
        );
        if (loginRes.data.code !== 1) throw new Error(`Login gagal: ${loginRes.data.message}`);
        const token = loginRes.headers['x-token'];
        for (let port = 1; port <= 16; port++) {
            const res = await axios.get(
                `http://${oltConfig.ip}:${oltConfig.port}/onu_allow_list?port_id=${port}`,
                { headers: { 'x-token': token }, timeout: 4000 }
            );
            const onuList = res.data.data || [];
            const found = onuList.find(x => x.macaddr && x.macaddr.toLowerCase().startsWith(searchMac.toLowerCase()));
            if (found) {
                console.log(`   ✅ Ditemukan di PON ${port}: ${found.macaddr}`);
                let redaman = found.receive_power || 'N/A';
                if (redaman !== 'N/A' && !String(redaman).includes('dBm')) redaman = `${redaman} dBm`;
                return { olt_name: `${oltConfig.label} (PON ${port})`, mac_onu: found.macaddr, redaman, status: found.status || 'Online' };
            }
        }
        console.log(`   ❌ Tidak ditemukan di semua port`);
        return null;
    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        return { error: error.message };
    }
}

// ==========================================
// 2. HSAirpo CIBAROLA (Axios API)
// ==========================================
async function cekRedamanHSAirpoCibarola(oltConfig, mac) {
    console.log(`\n🔍 [${oltConfig.label}] Mulai cek (Cibarola API)...`);
    try {
        const cleanTargetMac = mac.replace(/[:.-]/g, '').toLowerCase();
        const matchTarget = cleanTargetMac.substring(0, 11);
        console.log(`MAC dicari: ${matchTarget}...`);
        const passwordBase64 = Buffer.from(oltConfig.pass || 'admin').toString('base64');
        const loginRes = await axios.post(
            `http://${oltConfig.ip}:${oltConfig.port}/login/Auth`,
            { userName: oltConfig.user || 'admin', password: passwordBase64 },
            { headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, timeout: 8000 }
        );
        if (loginRes.data.errCode !== 'success') throw new Error('Login gagal');
        const cookies = loginRes.headers['set-cookie'];
        let sessionCookie = '';
        if (cookies) sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');
        const totalPon = oltConfig.total_pon || 4;
        for (let i = 1; i <= totalPon; i++) {
            const ponPort = `pon${i}`;
            const opticalRes = await axios.get(
                `http://${oltConfig.ip}:${oltConfig.port}/goform/getPortOnuOptical?${Math.random()}&PonPortName=${ponPort}`,
                { headers: { 'Cookie': sessionCookie, 'X-Requested-With': 'XMLHttpRequest' }, timeout: 10000 }
            );
            let jsonData = opticalRes.data;
            if (typeof jsonData === 'string') {
                try { jsonData = JSON.parse(jsonData); } catch (e) {}
            }
            if (jsonData && jsonData.list) {
                const found = jsonData.list.find(onu => {
                    const onuMac = (onu.mac || '').replace(/\./g, '').toLowerCase();
                    return onuMac.startsWith(matchTarget);
                });
                if (found) {
                    console.log(`   ✅ Ditemukan di ${ponPort.toUpperCase()}: ${found.mac}`);
                    let redaman = found.rxpower || 'N/A';
                    if (redaman !== 'N/A' && !String(redaman).includes('dBm')) redaman = `${redaman} dBm`;
                    return { olt_name: `${oltConfig.label} (${ponPort.toUpperCase()})`, mac_onu: found.mac, redaman, status: 'Online' };
                }
            }
        }
        console.log(`   ❌ Tidak ditemukan di semua PON`);
        return null;
    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        return { error: error.message };
    }
}

// ==========================================
// 3. HIOSO (Puppeteer) - FIXED untuk 8Pon + LEBIH CEPAT
// ==========================================
async function cekRedamanHioso(oltConfig, mac) {
    const startTime = Date.now();
    let searchMac = mac.substring(0, 16);
    if (oltConfig.label.includes('Cibarola') || oltConfig.label.includes('8Pon')) {
        searchMac = mac.substring(0, 15);
    }
    console.log(`\n🔍 [${oltConfig.label}] Mulai cek (Puppeteer)...`);
    console.log(`MAC dicari: ${searchMac} (Panjang: ${searchMac.length})`);

    // ⚡ Launch lebih cepat dengan argumen agresif
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--mute-audio',
            '--no-first-run',
            '--single-process'
        ]
    });

    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(12000);           // ⚡ 30s → 12s
        page.setDefaultNavigationTimeout(12000); // ⚡ 30s → 12s

        // Blokir resource tidak perlu (gambar/font/css) biar cepat
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        const baseUrl = `http://${oltConfig.ip}:${oltConfig.port}`;
        const user = oltConfig.user || 'admin';
        const pass = oltConfig.pass || 'admin';

        console.log(`   ⏳ Mengakses halaman utama OLT...`);
        await page.authenticate({ username: user, password: pass });
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        console.log(`   ✅ HTTP Basic Auth sukses (${Date.now() - startTime}ms)`);

        // ⚡ FIX HIOSO 8PON: Cek apakah ada form login web (double auth)
        // Beberapa Hioso (termasuk 8Pon) butuh HTTP Basic Auth + form login web
        await new Promise(r => setTimeout(r, 800)); // ⚡ 3s → 0.8s
        const hasWebForm = await page.$('#a').catch(() => null)
                        || await page.$('input[name="username"]').catch(() => null)
                        || await page.$('input[type="password"]').catch(() => null);

        if (hasWebForm) {
            console.log(`   🔑 Form login web terdeteksi, mengisi...`);
            try {
                const userField = await page.$('#a') || await page.$('input[name="username"]');
                const passField = await page.$('#b') || await page.$('input[type="password"]');
                if (userField) await userField.type(user, { delay: 30 });
                if (passField) await passField.type(pass, { delay: 30 });
                const btn = await page.$('input[type="button"]')
                         || await page.$('button[type="submit"]')
                         || await page.$('input[type="submit"]');
                if (btn) await btn.click();
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
                console.log(`   ✅ Form login web sukses`);
            } catch (err) {
                console.log(`   ⚠️ Form login error: ${err.message}`);
            }
        }

        // ==========================================
        // MODE 1: IFRAME = true (Cibarola & 8Pon)
        // ==========================================
        if (oltConfig.iframe) {
            console.log(`   Mode: HTTP Basic Auth + Iframe`);
            await new Promise(r => setTimeout(r, 1000)); // ⚡ 3s → 1s

            // Cari leftFrame untuk menu - lebih fleksibel
            let leftFrame = null;
            for (let attempt = 1; attempt <= 8; attempt++) { // ⚡ 15 → 8
                const frames = page.frames();
                leftFrame = frames.find(f => {
                    const name = (f.name() || '').toLowerCase();
                    const url = (f.url() || '').toLowerCase();
                    return name === 'leftframe' || name === 'menuframe' || name === 'left'
                        || name === 'menu' || url.includes('menu') || url.includes('left');
                });
                if (leftFrame) break;
                await new Promise(r => setTimeout(r, 500)); // ⚡ 1s → 0.5s
            }

            if (!leftFrame) {
                // ⚡ FALLBACK HIOSO 8PON: kalau iframe tidak ketemu, coba mode direct
                console.log(`   ⚠️ Iframe tidak ditemukan, coba mode direct...`);
                return await cobaModeDirect(page, baseUrl, oltConfig, searchMac, startTime);
            }

            console.log(`   ✅ leftFrame ditemukan: "${leftFrame.name()}"`);

            // Klik "All ONU" di menu
            try {
                await leftFrame.waitForSelector('a', { timeout: 5000 });
                await leftFrame.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const allOnuLink = links.find(link => {
                        const txt = (link.innerText || '').trim().toLowerCase();
                        return txt === 'all onu' || txt.includes('all onu');
                    });
                    if (allOnuLink) allOnuLink.click();
                });
                console.log(`   ✅ Klik All ONU sukses`);
            } catch (err) {
                console.log(`   ⚠️ Gagal klik All ONU: ${err.message}`);
            }

            await new Promise(r => setTimeout(r, 1000)); // ⚡ 3s → 1s

            // Cari mainFrame untuk tabel
            let mainFrame = null;
            for (let attempt = 1; attempt <= 8; attempt++) {
                const frames = page.frames();
                mainFrame = frames.find(f => {
                    const name = (f.name() || '').toLowerCase();
                    const url = (f.url() || '').toLowerCase();
                    return name === 'mainframe' || name === 'main' || name === 'content'
                        || url.includes('onu') || url.includes('all_onu');
                });
                if (mainFrame) break;
                await new Promise(r => setTimeout(r, 500));
            }

            if (!mainFrame) {
                console.log(`   ⚠️ Main frame tidak ditemukan, coba mode direct...`);
                return await cobaModeDirect(page, baseUrl, oltConfig, searchMac, startTime);
            }

            console.log(`   ✅ mainFrame ditemukan: "${mainFrame.name()}"`);

            // Tunggu tabel
            try {
                await mainFrame.waitForSelector('table tr', { timeout: 8000 }); // ⚡ 20s → 8s
            } catch (err) {
                console.log(`   ⚠️ Tabel tidak ditemukan`);
            }

            // Ubah limit tabel
            try {
                await mainFrame.evaluate(() => {
                    if (typeof setNumPerPage === 'function') setNumPerPage(300);
                    else if (typeof OnPageSizeChange === 'function') OnPageSizeChange(300);
                    else {
                        const sel = document.querySelector('select');
                        if (sel) {
                            sel.value = sel.options[sel.options.length - 1].value;
                            sel.dispatchEvent(new Event('change'));
                        }
                    }
                });
                await new Promise(r => setTimeout(r, 1000)); // ⚡ 2s → 1s
            } catch (err) {}

            // Cari MAC dan redaman
            const rxPowerResult = await mainFrame.evaluate((macToFind) => {
                const cleanTarget = macToFind.replace(/[:.-]/g, '').toLowerCase();
                const rows = Array.from(document.querySelectorAll('table tr'));
                for (let row of rows) {
                    const cleanRowText = row.innerText.replace(/[:.-]/g, '').toLowerCase();
                    if (cleanRowText.includes(cleanTarget)) {
                        const rowTextClean = row.innerText.replace(/\s+/g, ' ').trim();
                        const rxPattern = /-\d+\.\d+/;
                        const match = rowTextClean.match(rxPattern);
                        return match ? match[0] : null;
                    }
                }
                return null;
            }, searchMac);

            if (rxPowerResult) {
                console.log(`   ✅ Ditemukan! Redaman: ${rxPowerResult} dBm (${Date.now() - startTime}ms)`);
                return { olt_name: oltConfig.label, mac_onu: searchMac, redaman: `${rxPowerResult} dBm`, status: 'Online' };
            }

        // ==========================================
        // MODE 2: IFRAME = false (Perum & 4Pon)
        // ==========================================
        } else {
            console.log(`   Mode: HTTP Basic Auth + Direct URL`);
            return await cobaModeDirect(page, baseUrl, oltConfig, searchMac, startTime);
        }

        console.log(`   ❌ Tidak ditemukan di tabel`);
        return null;
    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        return { error: error.message };
    } finally {
        await browser.close().catch(() => {});
    }
}

// ==========================================
// HELPER: Mode Direct (untuk fallback 8Pon & mode iframe=false)
// ==========================================
async function cobaModeDirect(page, baseUrl, oltConfig, searchMac, startTime) {
    console.log(`   ⏳ Akses halaman ONU langsung...`);
    try {
        await page.goto(`${baseUrl}/m/onu_all_onu.htm`, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await new Promise(r => setTimeout(r, 1000));

        let targetFrame = page;
        const frames = page.frames();
        if (frames.length > 1) {
            targetFrame = frames.find(f => (f.url() || '').includes('onu')) || frames[1];
        }

        try {
            await targetFrame.waitForSelector('table tr', { timeout: 8000 });
        } catch (err) {
            console.log(`   ⚠️ Tabel tidak ditemukan: ${err.message}`);
        }

        const rxPowerResult = await targetFrame.evaluate((macToFind) => {
            const cleanTarget = macToFind.replace(/[:-]/g, '').toLowerCase();
            const rows = Array.from(document.querySelectorAll('table tr'));
            for (let row of rows) {
                const rowText = row.innerText.replace(/[:-]/g, '').toLowerCase();
                if (rowText.includes(cleanTarget)) {
                    const cleanRowText = row.innerText.replace(/\s+/g, ' ').trim();
                    const rxPattern = /\s(-\d+\.\d+)\s/;
                    const match = cleanRowText.match(rxPattern);
                    if (match) return match[1];
                }
            }
            return null;
        }, searchMac);

        if (rxPowerResult) {
            console.log(`   ✅ Ditemukan! Redaman: ${rxPowerResult} dBm (${Date.now() - startTime}ms)`);
            return { olt_name: oltConfig.label, mac_onu: searchMac, redaman: `${rxPowerResult} dBm`, status: 'Online' };
        }
        return null;
    } catch (err) {
        console.log(`   ⚠️ Mode direct gagal: ${err.message}`);
        return null;
    }
}

// ==========================================
// 4. RETRY WRAPPER - ⚡ LEBIH CEPAT (retry dikurangi)
// ==========================================
const MAX_RETRY_PER_OLT = 1;   // ⚡ 3 → 1 (total 2x percobaan saja)
const RETRY_DELAY_MS = 1000;   // ⚡ 2000 → 1000ms

async function cekDenganRetry(checkerFn, oltConfig, mac) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_RETRY_PER_OLT + 1; attempt++) {
        const hasil = await checkerFn(oltConfig, mac);
        if (!hasil || !hasil.error) return hasil;
        lastError = hasil.error;
        console.log(`   🔁 [${oltConfig.label}] Percobaan ${attempt}/${MAX_RETRY_PER_OLT + 1} gagal: ${lastError}`);
        if (attempt <= MAX_RETRY_PER_OLT) {
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
    }
    console.log(`   ⛔ [${oltConfig.label}] Tetap gagal setelah ${MAX_RETRY_PER_OLT + 1}x. Lanjut OLT berikutnya.`);
    return null;
}

// ==========================================
// 5. SCAN SEMUA OLT
// ==========================================
async function scanSemuaOlt(oltList, mac, onFound) {
    console.log(`\n========================================`);
    console.log(`🚀 MULAI SCAN ${oltList.length} OLT...`);
    console.log(`========================================`);
    for (const olt of oltList) {
        let hasil = null;
        if (olt.type === 'HSAirpo') {
            hasil = olt.method === 'cibarola'
                ? await cekDenganRetry(cekRedamanHSAirpoCibarola, olt, mac)
                : await cekDenganRetry(cekRedamanHSAirpoAPI, olt, mac);
        } else if (olt.type === 'Hioso') {
            hasil = await cekDenganRetry(cekRedamanHioso, olt, mac);
        } else {
            console.log(`   ⚠️ Tipe OLT tidak dikenal: ${olt.type}`);
            continue;
        }
        if (hasil && !hasil.error) {
            console.log(`\n✅ KETEMU di ${hasil.olt_name}, langsung balas & berhenti.`);
            const teksHasil = `\n✅ *${hasil.olt_name}*\n   📉 Redaman: *${hasil.redaman}*\n   📡 Status: ${hasil.status}`;
            await onFound(teksHasil);
            console.log(`========================================\n`);
            return true;
        }
    }
    console.log(`\n❌ Tidak ketemu di OLT manapun.`);
    console.log(`========================================\n`);
    return false;
}

module.exports = { scanSemuaOlt };
