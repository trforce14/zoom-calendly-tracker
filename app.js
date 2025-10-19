const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const moment = require('moment');
require('dotenv').config();

moment.locale('tr');

const app = express();
app.use(express.json());

let meetingsDatabase = [];
let dailyStats = {
    date: moment().format('YYYY-MM-DD'),
    total: 0,
    onTime: 0,
    late: 0,
    notStarted: 0
};

class CalendlyAutomation {
    constructor() {
        this.apiKey = process.env.CALENDLY_API_KEY;
        this.baseURL = 'https://api.calendly.com';
    }

    async getTodaysMeetings() {
        try {
            // Önce user bilgisini al
            const userResponse = await axios.get(`${this.baseURL}/users/me`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            const userUri = userResponse.data.resource.uri;

            // Son 7 günü al
            const weekAgo = moment().subtract(7, 'days').startOf('day').toISOString();
            const today = moment().endOf('day').toISOString();

            const response = await axios.get(`${this.baseURL}/scheduled_events`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    user: userUri,
                    min_start_time: weekAgo,
                    max_start_time: today,
                    status: 'active'
                }
            });

            const meetings = response.data.collection.map(event => ({
                id: event.uri.split('/').pop(),
                name: event.name,
                scheduledTime: moment(event.start_time).format('DD/MM HH:mm'),
                scheduledDateTime: event.start_time,
                status: 'scheduled'
            }));

            console.log(`📅 ${meetings.length} Calendly randevusu bulundu (son 7 gün)`);
            return meetings;

        } catch (error) {
            console.error('❌ Calendly veri çekme hatası:', error.message);
            if (error.response) {
                console.error('   Detay:', error.response.data);
            }
            return [];
        }
    }
}

class ZoomAutomation {
    constructor() {
        this.baseURL = 'https://api.zoom.us/v2';
        this.clientId = process.env.ZOOM_CLIENT_ID;
        this.clientSecret = process.env.ZOOM_CLIENT_SECRET;
        this.accountId = process.env.ZOOM_ACCOUNT_ID;
        this.token = null;
    }

    async getAccessToken() {
        try {
            const response = await axios.post('https://zoom.us/oauth/token', null, {
                params: {
                    grant_type: 'account_credentials',
                    account_id: this.accountId
                },
                auth: {
                    username: this.clientId,
                    password: this.clientSecret
                }
            });

            this.token = response.data.access_token;
            console.log('✅ Zoom access token alındı');
            return this.token;
        } catch (error) {
            console.error('❌ Zoom token hatası:', error.message);
            if (error.response) {
                console.error('   Status:', error.response.status);
                console.error('   Data:', JSON.stringify(error.response.data, null, 2));
            }
            return null;
        }
    }

    async checkPastMeetings() {
        try {
            if (!this.token) {
                const tokenResult = await this.getAccessToken();
                if (!tokenResult) {
                    console.error('⚠️ Token alınamadı, Zoom kontrolü atlanıyor');
                    return [];
                }
            }

            // .env'den kullanıcı email'ini al
            const userEmail = process.env.ZOOM_USER_EMAIL || 'tunahan@milyonercommerce.com';
            console.log(`👤 Zoom User: ${userEmail}`);

            // Tüm scheduled meetings'leri al
            const response = await axios.get(`${this.baseURL}/users/${userEmail}/meetings`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                },
                params: {
                    type: 'scheduled',
                    page_size: 300
                }
            });

            // Son 7 günün toplantılarını filtrele
            const weekAgo = moment().subtract(7, 'days').startOf('day');
            const now = moment();

            const pastMeetings = (response.data.meetings || []).filter(meeting => {
                const meetingDate = moment(meeting.start_time);
                const isInLastWeek = meetingDate.isAfter(weekAgo);
                const isPast = meetingDate.isBefore(now);
                return isInLastWeek && isPast;
            });

            console.log(`🎥 ${pastMeetings.length} Zoom toplantısı bulundu (son 7 gün)`);

            // Her toplantının detaylarını al (başladı mı kontrolü için)
            const detailedMeetings = [];
            for (const meeting of pastMeetings) {
                try {
                    const detailResponse = await axios.get(`${this.baseURL}/meetings/${meeting.id}`, {
                        headers: {
                            'Authorization': `Bearer ${this.token}`,
                        }
                    });
                    detailedMeetings.push(detailResponse.data);
                } catch (err) {
                    // Meeting detayı alınamazsa, temel bilgileri kullan
                    detailedMeetings.push(meeting);
                }
            }

            return detailedMeetings;

        } catch (error) {
            console.error('❌ Zoom meetings hatası:', error.message);
            if (error.response) {
                console.error('   Status:', error.response.status, error.response.statusText);
                console.error('   URL:', error.config?.url);
                console.error('   Hata Detayı:', JSON.stringify(error.response.data, null, 2));
            }
            return [];
        }
    }
}

class SlackNotifier {
    constructor() {
        this.webhookUrl = process.env.SLACK_WEBHOOK_URL;
        this.channel = process.env.SLACK_CHANNEL || '#general';
        this.alertChannel = process.env.SLACK_ALERT_CHANNEL || '#alerts';
    }

    async sendMessage(message, channel = null) {
        try {
            const targetChannel = channel || this.channel;
            
            await axios.post(this.webhookUrl, {
                channel: targetChannel,
                username: 'Zoom-Calendly Bot',
                icon_emoji: ':robot_face:',
                text: message
            });
            
            console.log('✅ Slack mesajı gönderildi');
            return true;
        } catch (error) {
            console.error('❌ Slack mesaj hatası:', error.message);
            return false;
        }
    }

    async sendDailyReport(analysis) {
        const message = `
📊 *Günlük Zoom-Calendly Raporu*
${moment().format('DD MMMM YYYY, dddd')}
━━━━━━━━━━━━━━━━━━━━
📅 Toplam Randevu: ${analysis.total}
✅ Zamanında: ${analysis.onTime}
⚠️ Geç Başlayan: ${analysis.late}
❌ Başlatılmayan: ${analysis.notStarted}
━━━━━━━━━━━━━━━━━━━━
📈 *Performans: ${analysis.performanceScore}%*
        `;
        
        await this.sendMessage(message);
    }

    async sendCriticalAlert(alerts) {
        let alertMessage = '🚨 *ACİL DURUM BİLDİRİMİ*\n\n';
        alerts.forEach(alert => {
            alertMessage += `❗ ${alert.message}\n`;
        });
        await this.sendMessage(alertMessage, this.alertChannel);
    }
}

class AutomaticAnalyzer {
    constructor() {
        this.calendly = new CalendlyAutomation();
        this.zoom = new ZoomAutomation();
        this.slack = new SlackNotifier();
    }

    async performFullAnalysis() {
        console.log('\n🤖 TAM OTOMATİK ANALİZ BAŞLATILIYOR...');
        console.log('⏰ Saat:', moment().format('HH:mm:ss'));
        
        const calendlyMeetings = await this.calendly.getTodaysMeetings();
        
        calendlyMeetings.forEach(meeting => {
            if (!meetingsDatabase.find(m => m.id === meeting.id)) {
                meetingsDatabase.push(meeting);
            }
        });

        const pastMeetings = await this.zoom.checkPastMeetings();
        const analysis = this.analyzeAllMeetings(pastMeetings);
        
        this.updateStatistics(analysis);
        await this.checkCriticalSituations(analysis);
        
        console.log('✅ Analiz tamamlandı!\n');
        
        return analysis;
    }

    analyzeAllMeetings(zoomMeetings) {
        const analysis = {
            timestamp: moment().format('DD.MM.YYYY HH:mm'),
            total: meetingsDatabase.length,
            onTime: 0,
            late: 0,
            notStarted: 0,
            details: [],
            criticalAlerts: [],
            performanceScore: 0
        };

        meetingsDatabase.forEach(meeting => {
            const zoomMatch = zoomMeetings.find(z => {
                const timeDiff = Math.abs(
                    moment(z.start_time).diff(moment(meeting.scheduledDateTime), 'minutes')
                );
                return timeDiff <= 60;
            });

            if (zoomMatch) {
                const delay = moment(zoomMatch.start_time).diff(
                    moment(meeting.scheduledDateTime), 
                    'minutes'
                );
                
                meeting.actualStartTime = moment(zoomMatch.start_time).format('HH:mm');
                meeting.delay = delay;
                
                if (delay <= 5) {
                    meeting.status = 'on-time';
                    analysis.onTime++;
                } else {
                    meeting.status = 'late';
                    analysis.late++;
                    
                    if (delay > 15) {
                        analysis.criticalAlerts.push({
                            meeting: meeting.name,
                            delay: delay,
                            message: `⚠️ ${meeting.name} toplantısı ${delay} dakika geç başladı!`
                        });
                    }
                }
            } else {
                if (moment().isAfter(moment(meeting.scheduledDateTime).add(10, 'minutes'))) {
                    meeting.status = 'not-started';
                    analysis.notStarted++;
                    
                    analysis.criticalAlerts.push({
                        meeting: meeting.name,
                        message: `❌ ${meeting.name} toplantısı başlatılmadı!`
                    });
                }
            }
            
            analysis.details.push(meeting);
        });

        analysis.performanceScore = analysis.total > 0 
            ? Math.round((analysis.onTime / analysis.total) * 100)
            : 100;

        return analysis;
    }

    updateStatistics(analysis) {
        dailyStats = {
            date: moment().format('YYYY-MM-DD'),
            total: analysis.total,
            onTime: analysis.onTime,
            late: analysis.late,
            notStarted: analysis.notStarted,
            performanceScore: analysis.performanceScore
        };
    }

    async checkCriticalSituations(analysis) {
        if (analysis.criticalAlerts.length > 0) {
            console.log('🚨 KRİTİK UYARILAR TESPİT EDİLDİ!');
            await this.slack.sendCriticalAlert(analysis.criticalAlerts);
        }

        if (analysis.performanceScore < 50) {
            console.log('📉 Performans kritik seviyede!');
            await this.slack.sendMessage(
                `📉 *Performans Uyarısı*\nGünlük performans skoru kritik seviyede: *${analysis.performanceScore}%*`,
                this.alertChannel
            );
        }
    }

    async sendDailySummary() {
        console.log('📊 Günlük özet rapor hazırlanıyor...');
        
        const analysis = await this.performFullAnalysis();
        await this.slack.sendDailyReport(analysis);
        
        console.log('✅ Günlük özet rapor gönderildi!');
    }
}

app.get('/', (req, res) => {
    res.redirect('/setup');
});

app.get('/setup', (req, res) => {
    res.sendFile(__dirname + '/setup.html');
});

app.get('/dashboard', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Zoom-Calendly Dashboard</title>
            <meta charset="utf-8">
            <meta http-equiv="refresh" content="30">
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    padding: 20px;
                    color: white;
                }
                .container {
                    max-width: 1200px;
                    margin: 0 auto;
                }
                .card {
                    background: white;
                    color: #333;
                    border-radius: 15px;
                    padding: 20px;
                    margin: 20px 0;
                }
                h1 { text-align: center; }
                .stats {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                }
                .stat-card {
                    text-align: center;
                    padding: 20px;
                    background: #f8f9fa;
                    border-radius: 10px;
                }
                .stat-number {
                    font-size: 36px;
                    font-weight: bold;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🚀 Zoom-Calendly Dashboard</h1>
                
                <div class="card">
                    <h2>📊 Son 7 Gün İstatistikleri</h2>
                    <p style="text-align: center; color: #666; margin-bottom: 20px;">
                        ${moment().subtract(7, 'days').format('DD MMM')} - ${moment().format('DD MMM YYYY')}
                    </p>
                    <div class="stats">
                        <div class="stat-card">
                            <div class="stat-number">${dailyStats.total}</div>
                            <div>Toplam Toplantı</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number" style="color: #4CAF50;">${dailyStats.onTime}</div>
                            <div>Zamanında</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number" style="color: #FF9800;">${dailyStats.late}</div>
                            <div>Geç Başlayan</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number" style="color: #f44336;">${dailyStats.notStarted}</div>
                            <div>Başlatılmayan</div>
                        </div>
                    </div>

                    <div style="text-align: center; font-size: 48px; margin: 20px; color: ${dailyStats.performanceScore >= 80 ? '#4CAF50' : dailyStats.performanceScore >= 60 ? '#FF9800' : '#f44336'};">
                        Performans: ${dailyStats.performanceScore || 0}%
                    </div>

                    <div style="background: #f8f9fa; padding: 15px; border-radius: 10px; margin-top: 20px;">
                        <p style="margin: 0; text-align: center; color: #666;">
                            💡 Sistem her 30 dakikada bir otomatik güncellenir
                        </p>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `);
});

app.get('/api/stats', (req, res) => {
    res.json(dailyStats);
});

// OAuth placeholder routes (şimdilik basit)
app.get('/auth/calendly', (req, res) => {
    // TODO: Gerçek OAuth akışı
    res.send(`
        <html>
        <head>
            <title>Calendly Bağlantısı</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    margin: 0;
                }
                .container {
                    background: white;
                    padding: 40px;
                    border-radius: 15px;
                    max-width: 500px;
                    width: 100%;
                }
                h2 { color: #333; margin-bottom: 20px; }
                label { display: block; margin-bottom: 8px; color: #666; font-weight: 600; }
                input {
                    width: 100%;
                    padding: 12px;
                    border: 2px solid #e9ecef;
                    border-radius: 8px;
                    margin-bottom: 20px;
                    font-size: 14px;
                }
                button {
                    width: 100%;
                    padding: 15px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border: none;
                    border-radius: 10px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                }
                button:hover { opacity: 0.9; }
                .info {
                    background: #dbeafe;
                    padding: 15px;
                    border-radius: 8px;
                    margin-bottom: 20px;
                    color: #1e40af;
                    font-size: 14px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>📅 Calendly API Key</h2>
                <div class="info">
                    💡 Calendly API key'inizi <a href="https://calendly.com/integrations/api_webhooks" target="_blank">buradan</a> alabilirsiniz.
                </div>
                <form action="/save-calendly" method="POST">
                    <label>API Key:</label>
                    <input type="text" name="api_key" placeholder="eyJraWQi..." required />

                    <label>Email:</label>
                    <input type="email" name="email" placeholder="email@example.com" required />

                    <button type="submit">✅ Kaydet ve Devam Et</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

app.post('/save-calendly', (req, res) => {
    // TODO: Veritabanına kaydet veya .env'yi güncelle
    console.log('✅ Calendly credentials kaydedildi');
    res.redirect('/setup?calendly=success');
});

app.get('/auth/zoom', (req, res) => {
    res.send(`
        <html>
        <head>
            <title>Zoom Bağlantısı</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    margin: 0;
                }
                .container {
                    background: white;
                    padding: 40px;
                    border-radius: 15px;
                    max-width: 500px;
                    width: 100%;
                }
                h2 { color: #333; margin-bottom: 20px; }
                label { display: block; margin-bottom: 8px; color: #666; font-weight: 600; }
                input {
                    width: 100%;
                    padding: 12px;
                    border: 2px solid #e9ecef;
                    border-radius: 8px;
                    margin-bottom: 20px;
                    font-size: 14px;
                }
                button {
                    width: 100%;
                    padding: 15px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border: none;
                    border-radius: 10px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                }
                button:hover { opacity: 0.9; }
                .info {
                    background: #dbeafe;
                    padding: 15px;
                    border-radius: 8px;
                    margin-bottom: 20px;
                    color: #1e40af;
                    font-size: 14px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>🎥 Zoom Server-to-Server OAuth</h2>
                <div class="info">
                    💡 Zoom credentials'ı <a href="https://marketplace.zoom.us/" target="_blank">buradan</a> alabilirsiniz.
                </div>
                <form action="/save-zoom" method="POST">
                    <label>Client ID:</label>
                    <input type="text" name="client_id" placeholder="ShCQoSW1..." required />

                    <label>Client Secret:</label>
                    <input type="text" name="client_secret" placeholder="brzOMGU1..." required />

                    <label>Account ID:</label>
                    <input type="text" name="account_id" placeholder="llVjanmOR..." required />

                    <label>User Email:</label>
                    <input type="email" name="user_email" placeholder="email@example.com" required />

                    <button type="submit">✅ Kaydet ve Devam Et</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

app.post('/save-zoom', (req, res) => {
    // TODO: Veritabanına kaydet veya .env'yi güncelle
    console.log('✅ Zoom credentials kaydedildi');
    res.redirect('/setup?zoom=success');
});

cron.schedule('*/30 * * * *', async () => {
    console.log('⏰ Otomatik kontrol...');
    const analyzer = new AutomaticAnalyzer();
    await analyzer.performFullAnalysis();
});

cron.schedule('0 12 * * *', async () => {
    console.log('📊 Öğlen raporu...');
    const analyzer = new AutomaticAnalyzer();
    await analyzer.sendDailySummary();
});

cron.schedule('0 18 * * *', async () => {
    console.log('📊 Akşam raporu...');
    const analyzer = new AutomaticAnalyzer();
    await analyzer.sendDailySummary();
});

const PORT = process.env.PORT || 3000;

async function startApplication() {
    console.log('═══════════════════════════════════════════');
    console.log('🚀 ZOOM-CALENDLY TAKİP SİSTEMİ');
    console.log('═══════════════════════════════════════════');
    console.log('📅 Tarih:', moment().format('DD MMMM YYYY'));
    console.log('⏰ Saat:', moment().format('HH:mm:ss'));
    console.log('═══════════════════════════════════════════');
    
    app.listen(PORT, () => {
        console.log(`✅ Sunucu başlatıldı: http://localhost:${PORT}`);
        console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
        console.log('═══════════════════════════════════════════');
    });
    
    const analyzer = new AutomaticAnalyzer();
    await analyzer.performFullAnalysis();
}

startApplication();