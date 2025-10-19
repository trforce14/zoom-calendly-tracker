const axios = require('axios');
require('dotenv').config();

// Test için TEAM_MEMBERS objesi
const TEAM_MEMBERS = {
    tunahan: {
        name: 'Tunahan',
        email: process.env.ZOOM_USER_EMAIL_TUNAHAN,
        zoomClientId: process.env.ZOOM_CLIENT_ID_TUNAHAN,
        zoomClientSecret: process.env.ZOOM_CLIENT_SECRET_TUNAHAN,
        zoomAccountId: process.env.ZOOM_ACCOUNT_ID_TUNAHAN
    },
    emre: {
        name: 'Emre',
        email: process.env.ZOOM_USER_EMAIL_EMRE,
        zoomClientId: process.env.ZOOM_CLIENT_ID_EMRE,
        zoomClientSecret: process.env.ZOOM_CLIENT_SECRET_EMRE,
        zoomAccountId: process.env.ZOOM_ACCOUNT_ID_EMRE
    },
    talha: {
        name: 'Talha',
        email: process.env.ZOOM_USER_EMAIL_TALHA,
        zoomClientId: process.env.ZOOM_CLIENT_ID_TALHA,
        zoomClientSecret: process.env.ZOOM_CLIENT_SECRET_TALHA,
        zoomAccountId: process.env.ZOOM_ACCOUNT_ID_TALHA
    }
};

async function testZoomUser(personKey) {
    const member = TEAM_MEMBERS[personKey];

    console.log('\n================================================================================');
    console.log(`📋 ${member.name} (${personKey}) TEST EDİLİYOR...`);
    console.log('================================================================================');

    try {
        // 1. Token Al
        console.log('🔐 Token alınıyor...');
        const tokenResponse = await axios.post('https://zoom.us/oauth/token', null, {
            params: {
                grant_type: 'account_credentials',
                account_id: member.zoomAccountId
            },
            auth: {
                username: member.zoomClientId,
                password: member.zoomClientSecret
            }
        });

        const token = tokenResponse.data.access_token;
        console.log(`✅ Token alındı: ${token.substring(0, 20)}...`);

        // 2. Kullanıcı bilgilerini çek
        console.log('\n👤 Kullanıcı bilgileri alınıyor...');
        const userResponse = await axios.get('https://api.zoom.us/v2/users/me', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log(`✅ Kullanıcı: ${userResponse.data.first_name} ${userResponse.data.last_name}`);
        console.log(`   Email: ${userResponse.data.email}`);
        console.log(`   Type: ${userResponse.data.type === 1 ? 'Basic' : userResponse.data.type === 2 ? 'Licensed' : 'Unknown'}`);

        // 3. Son 30 gün toplantıları
        console.log('\n📅 Son 30 günün toplantıları alınıyor...');
        const today = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(today.getDate() - 30);

        const meetingsResponse = await axios.get(`https://api.zoom.us/v2/report/users/${member.email}/meetings`, {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            params: {
                from: thirtyDaysAgo.toISOString().split('T')[0],
                to: today.toISOString().split('T')[0],
                page_size: 10
            }
        });

        const meetings = meetingsResponse.data.meetings || [];
        console.log(`✅ ${meetings.length} toplantı bulundu`);

        if (meetings.length > 0) {
            console.log(`\n📊 İlk 3 toplantı:`);
            meetings.slice(0, 3).forEach((meeting, index) => {
                console.log(`   ${index + 1}. ${meeting.topic} - ${meeting.start_time}`);
                console.log(`      Katılımcı: ${meeting.participants_count || 0}`);
            });
        }

        console.log(`\n✅ ${member.name} - TEST BAŞARILI!`);
        return true;

    } catch (error) {
        console.error(`\n❌ ${member.name} - TEST BAŞARISIZ!`);
        console.error(`Hata: ${error.message}`);
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error(`Data:`, error.response.data);
        }
        return false;
    }
}

async function runAllTests() {
    console.log('\n🚀 ÇOKLU KULLANICI TEST BAŞLATILIYOR...\n');

    const results = {};

    // Sırayla test et
    for (const personKey of Object.keys(TEAM_MEMBERS)) {
        results[personKey] = await testZoomUser(personKey);
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 saniye bekle
    }

    // Özet
    console.log('\n\n================================================================================');
    console.log('📊 TEST SONUÇLARI ÖZET');
    console.log('================================================================================');

    Object.entries(results).forEach(([key, success]) => {
        const member = TEAM_MEMBERS[key];
        console.log(`${success ? '✅' : '❌'} ${member.name} (${key})`);
    });

    const successCount = Object.values(results).filter(r => r).length;
    const totalCount = Object.keys(results).length;

    console.log(`\n📈 Başarı Oranı: ${successCount}/${totalCount}`);
    console.log('================================================================================\n');
}

runAllTests();
