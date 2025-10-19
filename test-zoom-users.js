const axios = require('axios');
require('dotenv').config();

async function testZoomOrganization() {
    try {
        // 1. Token Al
        console.log('🔐 Zoom token alınıyor...');
        const tokenResponse = await axios.post('https://zoom.us/oauth/token', null, {
            params: {
                grant_type: 'account_credentials',
                account_id: process.env.ZOOM_ACCOUNT_ID
            },
            auth: {
                username: process.env.ZOOM_CLIENT_ID,
                password: process.env.ZOOM_CLIENT_SECRET
            }
        });

        const token = tokenResponse.data.access_token;
        console.log('✅ Token alındı\n');

        // 2. Organization'daki tüm kullanıcıları listele
        console.log('👥 Organization kullanıcıları listeleniyor...\n');
        const usersResponse = await axios.get('https://api.zoom.us/v2/users', {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            params: {
                page_size: 300
            }
        });

        const users = usersResponse.data.users || [];
        console.log(`📊 Toplam ${users.length} kullanıcı bulundu:\n`);
        console.log('═'.repeat(80));

        users.forEach((user, index) => {
            console.log(`${index + 1}. ${user.first_name} ${user.last_name}`);
            console.log(`   Email: ${user.email}`);
            console.log(`   Type: ${user.type === 1 ? 'Basic' : user.type === 2 ? 'Licensed' : 'Unknown'}`);
            console.log(`   Status: ${user.status}`);
            console.log('─'.repeat(80));
        });

        // 3. Kontrol: Ekip üyeleri var mı?
        const teamEmails = [
            'tunahan@milyonercommerce.com',
            'talha@milyonercommerce.com',
            'yusuf@milyonercommerce.com',
            'furkan@milyonercommerce.com',
            'batuhan@milyonercommerce.com',
            'emre@milyonercommerce.com',
            'tarik@milyonercommerce.com'
        ];

        console.log('\n🔍 EKIP ÜYELERİ KONTROLÜ:\n');
        console.log('═'.repeat(80));
        
        teamEmails.forEach(email => {
            const found = users.find(u => u.email.toLowerCase() === email.toLowerCase());
            if (found) {
                console.log(`✅ ${email} - BULUNDU (${found.first_name} ${found.last_name})`);
            } else {
                console.log(`❌ ${email} - BULUNAMADI`);
            }
        });

    } catch (error) {
        console.error('❌ Hata:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        }
    }
}

testZoomOrganization();
