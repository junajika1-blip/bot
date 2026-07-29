// config.js - RnBNET BOT (Final Valid Version)
module.exports = {
    defaultMikrotik: {
        timeout: 15
    },

    servers: {
        // ==========================================
        // 1. PANGLEJAR
        // ==========================================
        panglejar: {
            label: 'Panglejar',
            mikrotik: {
                host: '103.191.165.115',
                port: 705,
                user: 'berry',
                pass: 'subang21'
            },
            olts: [
                {
                    type: 'HSAirpo',
                    label: 'HSAirpo Panglejar',
                    ip: '103.191.165.115',
                    port: 710,
                    user: 'root',
                    pass: 'admin'
                }
            ]
        },

        // ==========================================
        // 2. PERUM
        // ==========================================
        perum: {
            label: 'Perum',
            mikrotik: {
                host: '103.191.165.38',
                port: 8725,
                user: 'berry',
                pass: 'subang21'
            },
            olts: [
                {
                    type: 'Hioso',
                    label: 'Hioso Perum',
                    ip: '103.191.165.38',
                    port: 8422,
                    user: 'admin',
                    pass: 'admin',
                    iframe: false // Single Login
                }
            ]
        },

        // ==========================================
        // 3. CIBAROLA
        // ==========================================
        cibarola: {
            label: 'Cibarola',
            mikrotik: {
                host: '103.191.165.115',
                port: 8725,
                user: 'berry',
                pass: 'subang21'
            },
            olts: [
                {
                    type: 'Hioso',
                    label: 'Hioso Cibarola',
                    ip: '103.191.165.115',
                    port: 655,
                    user: 'admin',
                    pass: 'admin',
                    iframe: true // Double Login + Iframe
                },
                {
                    type: 'HSAirpo',
                    label: 'HSAirpo Cibarola',
                    ip: '103.191.165.115',
                    port: 704,
                    user: 'admin',
                    pass: 'admin',
                    method: 'cibarola', // Axios API Khusus Cibarola
                    total_pon: 4
                }
            ]
        },

        // ==========================================
        // 4. SUKAMELANG
        // ==========================================
        sukamelang: {
            label: 'Sukamelang',
            mikrotik: {
                host: '103.191.165.100',
                port: 3150,
                user: 'berry',
                pass: 'Subang21'
            },
            // Urutan array di bawah ini = urutan pengecekan (dari atas ke bawah).
            // Begitu redaman ketemu di salah satu OLT, sisanya TIDAK dicek lagi.
            olts: [
                {
                    // Didahulukan sesuai permintaan: 8Pon dicek paling pertama
                    type: 'Hioso',
                    label: 'Hioso 8Pon Sukamelang',
                    ip: '103.191.165.100',
                    port: 680,
                    user: 'admin',
                    pass: 'admin',
                    iframe: true // Double Login + Iframe
                },
                {
                    type: 'Hioso',
                    label: 'Hioso 4Pon Sukamelang',
                    ip: '103.191.165.100',
                    port: 670,
                    user: 'admin',
                    pass: 'admin',
                    iframe: false // Single Login
                },
                {
                    // ✅ OLT BARU. Cara login & cara kerja sama seperti Hioso 4Pon Sukamelang
                    // (HTTP Basic Auth langsung, single login, tanpa iframe).
                    // Label sementara pakai alamat IP - silakan ganti kalau ada nama/jumlah PON yang lebih pas.
                    type: 'Hioso',
                    label: 'Hioso Sukamelang (103.191.165.100)',
                    ip: '103.191.165.100',
                    port: 671,
                    user: 'admin',
                    pass: 'admin',
                    iframe: false // Single Login, sama seperti Hioso 4Pon Sukamelang
                },
                {
                    // Sesuai permintaan: HSAirpo TIDAK dicek duluan, jadi dipindah ke urutan terakhir
                    type: 'HSAirpo',
                    label: 'HSAirpo Sukamelang',
                    ip: '103.191.165.100',
                    port: 9900,
                    user: 'root',
                    pass: 'admin'
                }
            ]
        }
    }
};
