// ==========================================
// 3. Hioso (Puppeteer) - FIXED untuk 8Pon & MAC
// ==========================================
async function cekRedamanHioso(oltConfig, mac) {
    const startTime = Date.now();
    
    // ✅ FIX 1: Bersihkan MAC dari separator DULU, baru dipotong.
    // Ini menghindari masalah tanda titik dua di ujung (misal: 80:f7:a6:e3:37:)
    const cleanMacFull = mac.replace(/[:.-]/g, '').toLowerCase();
    let searchMac = cleanMacFull.substring(0, 12); // Default 12 karakter
    if (oltConfig.label.includes('8Pon')) {
        searchMac = cleanMacFull.substring(0, 10); // 8Pon pakai 10 karakter agar lebih aman
    }
    
    console.log(`\n🔍 [${oltConfig.label}] Mulai cek (Puppeteer)...`);
    console.log(`MAC dicari: ${searchMac} (Panjang: ${searchMac.length})`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(20000);
        page.setDefaultNavigationTimeout(20000);
        
        const baseUrl = `http://${oltConfig.ip}:${oltConfig.port}`;
        const user = oltConfig.user || 'admin';
        const pass = oltConfig.pass || 'admin';

        console.log(`   ⏳ Mengakses halaman utama OLT...`);
        await page.authenticate({ username: user, password: pass });
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        console.log(`   ✅ HTTP Basic Auth sukses (${Date.now() - startTime}ms)`);

        // ✅ FIX 2: Khusus 8Pon, cek apakah ada Form Login Web (#a dan #b)
        // Banyak Hioso 8Pon butuh double auth. Jika ada, isi dulu sebelum cari iframe.
        await new Promise(r => setTimeout(r, 1500));
        const hasWebForm = await page.$('#a').catch(() => null);
        
        if (hasWebForm && oltConfig.label.includes('8Pon')) {
            console.log(`   🔑 8Pon terdeteksi butuh Web Form Login, mengisi...`);
            try {
                await page.type('#a', user, { delay: 30 });
                await page.type('#b', pass, { delay: 30 });
                // Klik tombol login (biasanya input type button atau submit)
                const btn = await page.$('input[type="button"]') || await page.$('input[type="submit"]');
                if (btn) await btn.click();
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
                await new Promise(r => setTimeout(r, 2000));
                console.log(`   ✅ Web Form Login sukses`);
            } catch (err) {
                console.log(`   ⚠️ Gagal isi form web: ${err.message}`);
            }
        }

        // ==========================================
        // MODE 1: IFRAME = true (Cibarola & 8Pon)
        // ==========================================
        if (oltConfig.iframe) {
            console.log(`   Mode: HTTP Basic Auth + Iframe`);
            
            // Cari leftFrame untuk menu (timeout lebih lama & nama lebih fleksibel)
            let leftFrame = null;
            for (let attempt = 1; attempt <= 10; attempt++) {
                const frames = page.frames();
                leftFrame = frames.find(f => {
                    const name = (f.name() || '').toLowerCase();
                    const url = (f.url() || '').toLowerCase();
                    return name === 'leftframe' || name === 'menuframe' || name === 'left' 
                        || name === 'menu' || url.includes('menu') || url.includes('left');
                });
                if (leftFrame) break;
                await new Promise(r => setTimeout(r, 800));
            }

            if (!leftFrame) {
                console.log(`   ⚠️ Iframe tidak ditemukan, coba mode direct...`);
                return await cobaModeDirect(page, baseUrl, oltConfig, searchMac, startTime);
            }

            console.log(`   ✅ leftFrame ditemukan: "${leftFrame.name()}"`);

            // Klik "All ONU" di menu
            try {
                await leftFrame.waitForSelector('a', { timeout: 8000 });
                await leftFrame.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const allOnuLink = links.find(link => 
                        link.innerText.trim().toLowerCase().includes('all onu')
                    );
                    if (allOnuLink) allOnuLink.click();
                });
                console.log(`   ✅ Klik All ONU sukses`);
            } catch (err) {
                console.log(`   ⚠️ Gagal klik All ONU: ${err.message}`);
            }

            await new Promise(r => setTimeout(r, 2000));

            // Cari mainFrame untuk tabel
            let mainFrame = null;
            for (let attempt = 1; attempt <= 10; attempt++) {
                const frames = page.frames();
                mainFrame = frames.find(f => {
                    const name = (f.name() || '').toLowerCase();
                    const url = (f.url() || '').toLowerCase();
                    return name === 'mainframe' || name === 'main' || name === 'content'
                        || url.includes('onu') || url.includes('all_onu');
                });
                if (mainFrame) break;
                await new Promise(r => setTimeout(r, 800));
            }

            if (!mainFrame) {
                console.log(`   ⚠️ Main frame tidak ditemukan, coba mode direct...`);
                return await cobaModeDirect(page, baseUrl, oltConfig, searchMac, startTime);
            }

            console.log(`   ✅ mainFrame ditemukan: "${mainFrame.name()}"`);

            // Tunggu tabel
            try {
                await mainFrame.waitForSelector('table tr', { timeout: 10000 });
            } catch (err) {
                console.log(`   ️ Tabel tidak ditemukan`);
            }

            // Ubah limit tabel
            try {
                await mainFrame.evaluate(() => {
                    if (typeof setNumPerPage === 'function') setNumPerPage(300);
                    else if (typeof OnPageSizeChange === 'function') OnPageSizeChange(300);
                });
                await new Promise(r => setTimeout(r, 1000));
            } catch (err) {}

            // Cari MAC dan redaman
            const rxPowerResult = await mainFrame.evaluate((macToFind) => {
                const rows = Array.from(document.querySelectorAll('table tr'));
                for (let row of rows) {
                    const cleanRowText = row.innerText.replace(/[:.-]/g, '').toLowerCase();
                    if (cleanRowText.includes(macToFind)) {
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

        console.log(`    Tidak ditemukan di tabel`);
        return null;
    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        return { error: error.message };
    } finally {
        await browser.close().catch(() => {});
    }
}

// ==========================================
// HELPER: Mode Direct (Fallback untuk 8Pon & iframe=false)
// ==========================================
async function cobaModeDirect(page, baseUrl, oltConfig, searchMac, startTime) {
    console.log(`   ⏳ Akses halaman ONU langsung...`);
    try {
        // Pastikan login web form sudah dilakukan jika perlu (untuk fallback)
        await new Promise(r => setTimeout(r, 1000));
        const hasWebForm = await page.$('#a').catch(() => null);
        if (hasWebForm) {
            console.log(`   🔑 Mengisi form login web (fallback)...`);
            const user = oltConfig.user || 'admin';
            const pass = oltConfig.pass || 'admin';
            await page.type('#a', user, { delay: 30 });
            await page.type('#b', pass, { delay: 30 });
            const btn = await page.$('input[type="button"]') || await page.$('input[type="submit"]');
            if (btn) await btn.click();
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 1500));
        }

        await page.goto(`${baseUrl}/m/onu_all_onu.htm`, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await new Promise(r => setTimeout(r, 1500));

        let targetFrame = page;
        const frames = page.frames();
        if (frames.length > 1) {
            targetFrame = frames.find(f => (f.url() || '').includes('onu')) || frames[1];
        }

        try {
            await targetFrame.waitForSelector('table tr', { timeout: 8000 });
        } catch (err) {
            console.log(`   ⚠️ Tabel tidak ditemukan`);
        }

        const rxPowerResult = await targetFrame.evaluate((macToFind) => {
            const rows = Array.from(document.querySelectorAll('table tr'));
            for (let row of rows) {
                const cleanRowText = row.innerText.replace(/[:.-]/g, '').toLowerCase();
                if (cleanRowText.includes(macToFind)) {
                    const rowTextClean = row.innerText.replace(/\s+/g, ' ').trim();
                    const rxPattern = /\s(-\d+\.\d+)\s/;
                    const match = rowTextClean.match(rxPattern);
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
