const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const moment = require('moment');
require('dotenv').config();

moment.locale('tr');

const app = express();
app.use(express.json());

// Tüm ekip üyelerinin bilgileri
const TEAM_MEMBERS = {
    tunahan: {
        name: 'Tunahan',
        email: process.env.ZOOM_USER_EMAIL_TUNAHAN,
        calendlyApiKey: process.env.CALENDLY_API_KEY_TUNAHAN,
        calendlyEmail: process.env.CALENDLY_USER_EMAIL_TUNAHAN,
        zoomClientId: process.env.ZOOM_CLIENT_ID_TUNAHAN,
        zoomClientSecret: process.env.ZOOM_CLIENT_SECRET_TUNAHAN,
        zoomAccountId: process.env.ZOOM_ACCOUNT_ID_TUNAHAN
    },
    talha: {
        name: 'Talha',
        email: process.env.ZOOM_USER_EMAIL_TALHA,
        calendlyApiKey: process.env.CALENDLY_API_KEY_TALHA,
        calendlyEmail: process.env.CALENDLY_USER_EMAIL_TALHA,
        zoomClientId: process.env.ZOOM_CLIENT_ID_TALHA,
        zoomClientSecret: process.env.ZOOM_CLIENT_SECRET_TALHA,
        zoomAccountId: process.env.ZOOM_ACCOUNT_ID_TALHA
    },
    yusuf: {
        name: 'Yusuf',
        email: process.env.ZOOM_USER_EMAIL_YUSUF,
        calendlyApiKey: process.env.CALENDLY_API_KEY_YUSUF,
        calendlyEmail: process.env.CALENDLY_USER_EMAIL_YUSUF,
        zoomClientId: process.env.ZOOM_CLIENT_ID_YUSUF,
        zoomClientSecret: process.env.ZOOM_CLIENT_SECRET_YUSUF,
        zoomAccountId: process.env.ZOOM_ACCOUNT_ID_YUSUF
    },
    furkan: {
        name: 'Furkan',
        email: process.env.ZOOM_USER_EMAIL_FURKAN,
        calendlyApiKey: process.env.CALENDLY_API_KEY_FURKAN,
        calendlyEmail: process.env.CALENDLY_USER_EMAIL_FURKAN,
        zoomClientId: process.env.ZOOM_CLIENT_ID_FURKAN,
        zoomClientSecret: process.env.ZOOM_CLIENT_SECRET_FURKAN,
        zoomAccountId: process.env.ZOOM_ACCOUNT_ID_FURKAN
    },
    batuhan: {
        name: 'Batuhan',
        email: process.env.ZOOM_USER_EMAIL_BATUHAN,
        calendlyApiKey: process.env.CALENDLY_API_KEY_BATUHAN,
        calendlyEmail: process.env.CALENDLY_USER_EMAIL_BATUHAN,
        zoomClientId: process.env.ZOOM_CLIENT_ID_BATUHAN,
        zoomClientSecret: process.env.ZOOM_CLIENT_SECRET_BATUHAN,
        zoomAccountId: process.env.ZOOM_ACCOUNT_ID_BATUHAN
    },
    emre: {
        name: 'Emre',
        email: process.env.ZOOM_USER_EMAIL_EMRE,
        calendlyApiKey: process.env.CALENDLY_API_KEY_EMRE,
        calendlyEmail: process.env.CALENDLY_USER_EMAIL_EMRE,
        zoomClientId: process.env.ZOOM_CLIENT_ID_EMRE,
        zoomClientSecret: process.env.ZOOM_CLIENT_SECRET_EMRE,
        zoomAccountId: process.env.ZOOM_ACCOUNT_ID_EMRE
    },
    tarik: {
        name: 'Tarık',
        email: process.env.ZOOM_USER_EMAIL_TARIK,
        calendlyApiKey: process.env.CALENDLY_API_KEY_TARIK,
        calendlyEmail: process.env.CALENDLY_USER_EMAIL_TARIK,
        zoomClientId: process.env.ZOOM_CLIENT_ID_TARIK,
        zoomClientSecret: process.env.ZOOM_CLIENT_SECRET_TARIK,
        zoomAccountId: process.env.ZOOM_ACCOUNT_ID_TARIK
    }
};

let meetingsDatabase = [];
let dailyStats = {
    date: moment().format('YYYY-MM-DD'),
    total: 0,
    onTime: 0,
    late: 0,
    notStarted: 0
};

class CalendlyAutomation {
    constructor(personKey = null) {
        this.baseURL = 'https://api.calendly.com';
        this.personKey = personKey;

        // Eğer person key verilmişse, o kişinin API key'ini kullan
        if (personKey && TEAM_MEMBERS[personKey]) {
            const member = TEAM_MEMBERS[personKey];
            this.apiKey = member.calendlyApiKey;
            this.userEmail = member.calendlyEmail;
        } else {
            // Fallback: Tunahan'ın API key'i (eski sistem için uyumluluk)
            this.apiKey = process.env.CALENDLY_API_KEY_TUNAHAN;
            this.userEmail = process.env.CALENDLY_USER_EMAIL_TUNAHAN;
        }
    }

    async getTodaysMeetings(startDate = null, endDate = null) {
        try {
            // Önce user bilgisini al
            const userResponse = await axios.get(`${this.baseURL}/users/me`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            const userUri = userResponse.data.resource.uri;

            // Tarih aralığını belirle
            const startTime = startDate
                ? moment(startDate).startOf('day').toISOString()
                : moment().subtract(30, 'days').startOf('day').toISOString();
            const endTime = endDate
                ? moment(endDate).endOf('day').toISOString()
                : moment().endOf('day').toISOString();

            // Pagination ile tüm randevuları çek
            let allEvents = [];
            let nextPageUrl = `${this.baseURL}/scheduled_events?user=${encodeURIComponent(userUri)}&min_start_time=${encodeURIComponent(startTime)}&max_start_time=${encodeURIComponent(endTime)}&status=active&count=100`;

            while (nextPageUrl) {
                const response = await axios.get(nextPageUrl, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                });

                allEvents = allEvents.concat(response.data.collection || []);
                nextPageUrl = response.data.pagination?.next_page || null;

                // Sonsuz döngü önlemi
                if (allEvents.length > 1000) {
                    console.log('⚠️  1000+ randevu, durduruluyor');
                    break;
                }
            }

            // İptal edilenleri filtrele
            const totalEvents = allEvents.length;
            const meetings = allEvents
                .filter(event => event.status !== 'canceled') // İptal edilenleri çıkar
                .map(event => ({
                    id: event.uri.split('/').pop(),
                    name: event.name,
                    scheduledTime: moment(event.start_time).format('DD/MM HH:mm'),
                    scheduledDateTime: event.start_time,
                    inviteeName: event.name,
                    status: 'scheduled',
                    calendlyStatus: event.status // Calendly'deki gerçek statusu da kaydet
                }));

            const canceledCount = totalEvents - meetings.length;
            const daysDiff = moment(endTime).diff(moment(startTime), 'days');
            console.log(`📅 ${meetings.length} Calendly randevusu bulundu (${daysDiff} gün)${canceledCount > 0 ? ` | ${canceledCount} iptal edilmiş randevu filtrelendi` : ''}`);
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
    constructor(personKey = null) {
        this.baseURL = 'https://api.zoom.us/v2';
        this.personKey = personKey;

        // Eğer person key verilmişse, o kişinin credentials'larını kullan
        if (personKey && TEAM_MEMBERS[personKey]) {
            const member = TEAM_MEMBERS[personKey];
            this.clientId = member.zoomClientId;
            this.clientSecret = member.zoomClientSecret;
            this.accountId = member.zoomAccountId;
            this.userEmail = member.email;
        } else {
            // Fallback: Tunahan'ın credentials'ları (eski sistem için uyumluluk)
            this.clientId = process.env.ZOOM_CLIENT_ID_TUNAHAN;
            this.clientSecret = process.env.ZOOM_CLIENT_SECRET_TUNAHAN;
            this.accountId = process.env.ZOOM_ACCOUNT_ID_TUNAHAN;
            this.userEmail = process.env.ZOOM_USER_EMAIL_TUNAHAN;
        }

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
            console.log(`✅ Zoom access token alındı (${this.personKey || 'default'})`);
            return this.token;
        } catch (error) {
            console.error(`❌ Zoom token hatası (${this.personKey || 'default'}):`, error.message);
            if (error.response) {
                console.error('   Status:', error.response.status);
                console.error('   Data:', JSON.stringify(error.response.data, null, 2));
            }
            return null;
        }
    }

    async checkPastMeetings(startDate = null, endDate = null, userEmail = null) {
        try {
            if (!this.token) {
                const tokenResult = await this.getAccessToken();
                if (!tokenResult) {
                    console.error('⚠️ Token alınamadı, Zoom kontrolü atlanıyor');
                    return [];
                }
            }

            // Eğer userEmail parametre olarak gönderilmemişse, constructor'daki email'i kullan
            const email = userEmail || this.userEmail;
            console.log(`👤 Zoom User: ${email}`);

            // Tarih aralığını belirle (max 30 gün - Zoom Report API limiti)
            const startMoment = startDate
                ? moment(startDate).startOf('day')
                : moment().subtract(30, 'days').startOf('day');
            const endMoment = endDate
                ? moment(endDate).endOf('day')
                : moment();

            console.log(`📅 Tarih aralığı: ${startMoment.format('YYYY-MM-DD')} - ${endMoment.format('YYYY-MM-DD')}`);

            // Report API kullanarak geçmiş toplantıları çek
            const response = await axios.get(`${this.baseURL}/report/users/${email}/meetings`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                },
                params: {
                    page_size: 300,
                    from: startMoment.format('YYYY-MM-DD'),
                    to: endMoment.format('YYYY-MM-DD')
                }
            });

            const pastMeetings = response.data.meetings || [];
            const daysDiff = endMoment.diff(startMoment, 'days');
            console.log(`🎥 ${pastMeetings.length} Zoom toplantısı bulundu (${daysDiff} gün)`);

            // Katılımcı sayısını ekle (Report API'den geliyor)
            return pastMeetings.map(m => ({
                ...m,
                participants_count: m.participants_count || 0,
                uuid: m.uuid // UUID'yi sakla (katılımcı detayları için gerekli)
            }));

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

    async getParticipants(meetingUUID) {
        try {
            // UUID'yi encode et (Zoom API gereksinimi)
            const encodedUUID = encodeURIComponent(encodeURIComponent(meetingUUID));

            const response = await axios.get(`${this.baseURL}/report/meetings/${encodedUUID}/participants`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                },
                params: {
                    page_size: 30
                }
            });

            const participants = response.data.participants || [];
            return participants.map(p => p.name || 'İsimsiz');
        } catch (error) {
            console.error('❌ Katılımcı bilgisi alınamadı:', error.message);
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
        let message = `
📊 *Günlük Zoom-Calendly Raporu*
${moment().format('DD MMMM YYYY, dddd')}
${analysis.personName ? `👤 *${analysis.personName}*` : ''}
━━━━━━━━━━━━━━━━━━━━
📅 Toplam Randevu: ${analysis.total}
✅ Zamanında: ${analysis.onTime}
⚠️ Geç Başlayan: ${analysis.late}
👻 Katılım Yok: ${analysis.noParticipation}
❌ Başlatılmayan: ${analysis.notStarted}
━━━━━━━━━━━━━━━━━━━━
📈 *Performans: ${analysis.performanceScore}%*
`;

        // GEÇ KALAN TOPLANTI DETAYLARI
        if (analysis.lateDetails && analysis.lateDetails.length > 0) {
            message += `\n⚠️ *GEÇ KALAN TOPLANTI DETAYLARI:*\n`;
            analysis.lateDetails.forEach((detail, index) => {
                message += `${index + 1}. ⚠️ *GEÇ KALDI* - ${analysis.personName || 'Bilinmeyen'} - ${detail.name}\n`;
                message += `   🕐 Planlandı: ${detail.scheduledTime}\n`;
                message += `   ⏱️ Gecikme: ${detail.delay} dakika\n`;
                message += `   👥 Katılımcılar: ${detail.participants.join(', ')}\n\n`;
            });
        }

        // KATILMAYANLAR
        if (analysis.noParticipationDetails && analysis.noParticipationDetails.length > 0) {
            message += `\n👻 *KATILIM YOK - DETAYLAR:*\n`;
            analysis.noParticipationDetails.forEach((detail, index) => {
                message += `${index + 1}. 👻 *KATILMADI* - ${analysis.personName || 'Bilinmeyen'} - ${detail.name}\n`;
                message += `   🕐 Planlandı: ${detail.scheduledTime}\n`;
                message += `   👥 Sadece: ${detail.participants.join(', ')}\n\n`;
            });
        }

        // BAŞLATILMAYANLAR
        if (analysis.notStartedDetails && analysis.notStartedDetails.length > 0) {
            message += `\n❌ *BAŞLATILMAYAN TOPLANTI DETAYLARI:*\n`;
            analysis.notStartedDetails.forEach((detail, index) => {
                message += `${index + 1}. ❌ *BAŞLATILMADI* - ${analysis.personName || 'Bilinmeyen'} - ${detail.name}\n`;
                message += `   🕐 Planlandı: ${detail.scheduledTime}\n\n`;
            });
        }

        await this.sendMessage(message);
    }

    async sendCriticalAlert(alerts) {
        if (!alerts || alerts.length === 0) return;

        let alertMessage = '🚨 *ACİL DURUM BİLDİRİMİ*\n\n';
        alerts.forEach((alert, index) => {
            const person = alert.personName || 'Bilinmeyen';

            // Mesajdan durumu çıkar ve başa ekle
            if (alert.message.includes('geç başladı')) {
                alertMessage += `${index + 1}. ⚠️ *GEÇ KALDI* - ${person} - ${alert.meeting}\n`;
                if (alert.delay) {
                    alertMessage += `   ⏱️ Gecikme: ${alert.delay} dakika\n`;
                }
            } else if (alert.message.includes('katılmadı')) {
                alertMessage += `${index + 1}. 👻 *KATILMADI* - ${person} - ${alert.meeting}\n`;
            } else if (alert.message.includes('başlatılmadı')) {
                alertMessage += `${index + 1}. ❌ *BAŞLATILMADI* - ${person} - ${alert.meeting}\n`;
            } else {
                alertMessage += `${index + 1}. ${alert.message}\n`;
            }
            alertMessage += '\n';
        });
        await this.sendMessage(alertMessage, this.alertChannel);
    }
}

class AutomaticAnalyzer {
    constructor(personKey = null) {
        this.calendly = new CalendlyAutomation(personKey);
        this.zoom = new ZoomAutomation(personKey);
        this.slack = new SlackNotifier();
        this.personKey = personKey;
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
        const analysis = await this.analyzeAllMeetings(pastMeetings);

        this.updateStatistics(analysis);
        await this.checkCriticalSituations(analysis);
        
        console.log('✅ Analiz tamamlandı!\n');
        
        return analysis;
    }

    async analyzeAllMeetings(zoomMeetings, meetingsToAnalyze = null) {
        // Eğer özel bir toplantı listesi verilmişse onu kullan, yoksa global database'i kullan
        const meetings = meetingsToAnalyze || meetingsDatabase;

        // Kişi bilgisini al
        const personInfo = this.personKey ? TEAM_MEMBERS[this.personKey] : null;
        const personName = personInfo ? personInfo.name : 'Bilinmeyen';

        const analysis = {
            timestamp: moment().format('DD.MM.YYYY HH:mm'),
            personName: personName,
            total: meetings.length,
            onTime: 0,
            late: 0,
            noParticipation: 0,
            notStarted: 0,
            details: [],
            lateDetails: [],
            noParticipationDetails: [],
            notStartedDetails: [],
            criticalAlerts: [],
            performanceScore: 0
        };

        console.log('\n🔍 EŞLEŞME ANALİZİ BAŞLIYOR...');
        console.log(`📊 Toplam Calendly randevu: ${meetings.length}`);
        console.log(`📊 Toplam Zoom toplantı: ${zoomMeetings.length}`);
        console.log('─'.repeat(80));

        for (let index = 0; index < meetings.length; index++) {
            const meeting = meetings[index];
            console.log(`\n[${index + 1}/${meetings.length}] ${meeting.name} - ${moment(meeting.scheduledDateTime).format('YYYY-MM-DD HH:mm')}`);

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
                const participantsCount = zoomMatch.participants_count || 0;

                console.log(`  ✅ EŞLEŞME! Zoom: "${zoomMatch.topic}" | Gecikme: ${delay} dk | Katılımcı: ${participantsCount}`);

                meeting.actualStartTime = moment(zoomMatch.start_time).format('HH:mm');
                meeting.delay = delay;
                meeting.participantsCount = participantsCount;

                // Katılımcı kontrolü: 1 veya daha az = Sadece satış ekibi, müşteri gelmemiş
                if (participantsCount <= 1) {
                    meeting.status = 'no-participation';
                    analysis.noParticipation++;

                    // Katılımcı isimlerini al
                    const participantNames = await this.zoom.getParticipants(zoomMatch.uuid);

                    analysis.noParticipationDetails.push({
                        name: meeting.name,
                        scheduledTime: meeting.scheduledTime,
                        participants: participantNames.length > 0 ? participantNames : [`${participantsCount} kişi`]
                    });
                    console.log(`     👻 KATILIM YOK (Sadece ${participantsCount} kişi: ${participantNames.join(', ')})`);

                    analysis.criticalAlerts.push({
                        meeting: meeting.name,
                        personName: personName,
                        message: `👻 ${meeting.name} toplantısına müşteri katılmadı!`
                    });
                } else if (delay <= 5) {
                    meeting.status = 'on-time';
                    analysis.onTime++;
                    console.log(`     ✅ Zamanında (${participantsCount} katılımcı)`);
                } else {
                    meeting.status = 'late';
                    analysis.late++;

                    // Katılımcı isimlerini al
                    const participantNames = await this.zoom.getParticipants(zoomMatch.uuid);

                    analysis.lateDetails.push({
                        name: meeting.name,
                        scheduledTime: meeting.scheduledTime,
                        delay: delay,
                        participants: participantNames.length > 0 ? participantNames : [`${participantsCount} katılımcı`]
                    });
                    console.log(`     ⚠️ GEÇ (${delay} dakika, ${participantsCount} katılımcı: ${participantNames.join(', ')})`);

                    if (delay > 15) {
                        analysis.criticalAlerts.push({
                            meeting: meeting.name,
                            personName: personName,
                            delay: delay,
                            message: `⚠️ ${meeting.name} toplantısı ${delay} dakika geç başladı!`
                        });
                    }
                }
            } else {
                if (moment().isAfter(moment(meeting.scheduledDateTime).add(10, 'minutes'))) {
                    meeting.status = 'not-started';
                    analysis.notStarted++;
                    console.log(`  ❌ Başlatılmadı`);

                    analysis.notStartedDetails.push({
                        name: meeting.name,
                        scheduledTime: meeting.scheduledTime
                    });

                    analysis.criticalAlerts.push({
                        meeting: meeting.name,
                        personName: personName,
                        message: `❌ ${meeting.name} toplantısı başlatılmadı!`
                    });
                } else {
                    console.log(`  ⏳ Henüz başlamamış`);
                }
            }

            analysis.details.push(meeting);
        }

        analysis.performanceScore = analysis.total > 0
            ? Math.round((analysis.onTime / analysis.total) * 100)
            : 100;

        console.log('\n' + '═'.repeat(80));
        console.log('📊 ANALİZ SONUÇLARI:');
        console.log(`   Toplam: ${analysis.total}`);
        console.log(`   ✅ Zamanında: ${analysis.onTime}`);
        console.log(`   ⚠️ Geç: ${analysis.late}`);
        console.log(`   👻 Katılım Yok: ${analysis.noParticipation}`);
        console.log(`   ❌ Başlatılmadı: ${analysis.notStarted}`);
        console.log(`   📈 Performans: ${analysis.performanceScore}%`);
        console.log('═'.repeat(80) + '\n');

        return analysis;
    }

    updateStatistics(analysis) {
        dailyStats = {
            date: moment().format('YYYY-MM-DD'),
            noParticipation: analysis.noParticipation,
            lateDetails: analysis.lateDetails,
            noParticipationDetails: analysis.noParticipationDetails,
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

app.get('/dashboard', async (req, res) => {
    // Tarih ve kişi parametrelerini al - tarih yoksa default son 30 gün
    const startDate = req.query.start || moment().subtract(30, 'days').format('YYYY-MM-DD');
    const endDate = req.query.end || moment().format('YYYY-MM-DD');
    const selectedPerson = req.query.person || 'tunahan'; // Default: Tunahan

    console.log(`\n🌐 Dashboard isteği geldi: start=${startDate}, end=${endDate}, person=${selectedPerson}`);

    // Seçilen kişinin bilgilerini al
    const personInfo = TEAM_MEMBERS[selectedPerson] || TEAM_MEMBERS.tunahan;
    const userEmail = personInfo.email;

    // Her zaman analiz yap
    let stats = { ...dailyStats, personName: personInfo.name };
    try {
        // Seçilen kişiye özel analyzer oluştur
        const analyzer = new AutomaticAnalyzer(selectedPerson);
        const calendlyMeetings = await analyzer.calendly.getTodaysMeetings(startDate, endDate);
        const zoomMeetings = await analyzer.zoom.checkPastMeetings(startDate, endDate);

        // Sadece bu tarih aralığındaki toplantıları analiz et (global database'e ekleme yapma)
        const analysis = await analyzer.analyzeAllMeetings(zoomMeetings, calendlyMeetings);

        stats = {
            total: analysis.total,
            onTime: analysis.onTime,
            late: analysis.late,
            noParticipation: analysis.noParticipation,
            notStarted: analysis.notStarted,
            performanceScore: analysis.performanceScore,
            lateDetails: analysis.lateDetails,
            noParticipationDetails: analysis.noParticipationDetails,
            personName: personInfo.name
        };
    } catch (error) {
        console.error('Dashboard analiz hatası:', error);
    }

    // Cache'i devre dışı bırak
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Zoom-Calendly Dashboard</title>
            <meta charset="utf-8">
            <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
            <meta http-equiv="Pragma" content="no-cache">
            <meta http-equiv="Expires" content="0">
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
                .date-filter {
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 10px;
                    margin-bottom: 20px;
                    display: flex;
                    gap: 15px;
                    align-items: end;
                    flex-wrap: wrap;
                }
                .date-input {
                    flex: 1;
                    min-width: 200px;
                }
                .date-input label {
                    display: block;
                    margin-bottom: 5px;
                    font-weight: 600;
                    color: #666;
                }
                .date-input input, .date-input select {
                    width: 100%;
                    padding: 10px;
                    border: 2px solid #e9ecef;
                    border-radius: 8px;
                    font-size: 14px;
                    background: white;
                    cursor: pointer;
                }
                .date-input select:hover {
                    border-color: #667eea;
                }
                .filter-btn {
                    padding: 10px 30px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: transform 0.2s;
                }
                .filter-btn:hover {
                    transform: translateY(-2px);
                }
                .quick-filters {
                    display: flex;
                    gap: 10px;
                    flex-wrap: wrap;
                }
                .quick-btn {
                    padding: 8px 16px;
                    background: white;
                    border: 2px solid #667eea;
                    color: #667eea;
                    border-radius: 6px;
                    font-size: 14px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .quick-btn:hover {
                    background: #667eea;
                    color: white;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🚀 Zoom-Calendly Dashboard</h1>

                <div class="card">
                    <h2>📊 İstatistikler - ${stats.personName || personInfo.name}</h2>

                    <!-- Kişi ve Tarih Filtresi -->
                    <div class="date-filter">
                        <div class="date-input">
                            <label>👤 Ekip Üyesi</label>
                            <select id="personSelect">
                                ${Object.keys(TEAM_MEMBERS).map(key => `
                                    <option value="${key}" ${selectedPerson === key ? 'selected' : ''}>
                                        ${TEAM_MEMBERS[key].name}
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                        <div class="date-input">
                            <label>Başlangıç Tarihi</label>
                            <input type="date" id="startDate" value="${startDate}">
                        </div>
                        <div class="date-input">
                            <label>Bitiş Tarihi</label>
                            <input type="date" id="endDate" value="${endDate}">
                        </div>
                        <button class="filter-btn" onclick="applyFilter()">Filtrele</button>
                    </div>

                    <!-- Hızlı Filtreler -->
                    <div class="quick-filters" style="margin-bottom: 20px;">
                        <button class="quick-btn" onclick="setQuickFilter(7)">Son 7 Gün</button>
                        <button class="quick-btn" onclick="setQuickFilter(30)">Son 30 Gün</button>
                        <button class="quick-btn" onclick="setQuickFilter(90)">Son 90 Gün</button>
                    </div>

                    <p style="text-align: center; color: #666; margin-bottom: 20px;">
                        ${moment(startDate).format('DD MMM YYYY')} - ${moment(endDate).format('DD MMM YYYY')}
                    </p>
                    <div class="stats">
                        <div class="stat-card">
                            <div class="stat-number">${stats.total}</div>
                            <div>Toplam Toplantı</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number" style="color: #4CAF50;">${stats.onTime}</div>
                            <div>Zamanında</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number" style="color: #FF9800;">${stats.late}</div>
                            <div>Geç Başlayan</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number" style="color: #9C27B0;">${stats.noParticipation || 0}</div>
                            <div>Katılım Yok</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number" style="color: #f44336;">${stats.notStarted}</div>
                            <div>Başlatılmayan</div>
                        </div>
                    </div>

                    <div style="text-align: center; font-size: 48px; margin: 20px; color: ${stats.performanceScore >= 80 ? '#4CAF50' : stats.performanceScore >= 60 ? '#FF9800' : '#f44336'};">
                        Performans: ${stats.performanceScore || 0}%
                    </div>

                    ${stats.lateDetails && stats.lateDetails.length > 0 ? `
                    <div style="background: #FFF3E0; border-left: 4px solid #FF9800; padding: 15px; border-radius: 8px; margin-top: 20px;">
                        <h3 style="margin: 0 0 10px 0; color: #E65100;">⚠️ Geç Başlayan Toplantılar (${stats.lateDetails.length})</h3>
                        <ul style="margin: 0; padding-left: 20px; color: #666;">
                            ${stats.lateDetails.map(meeting => `
                                <li style="margin: 5px 0;">
                                    <strong>${meeting.name}</strong> - ${meeting.scheduledTime}
                                    <span style="color: #FF9800; font-weight: bold;"> → ${meeting.delay} dakika geç</span>
                                    <span style="color: #666;"> (${Array.isArray(meeting.participants) ? meeting.participants.join(', ') : meeting.participants})</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                    ` : ''}

                    ${stats.noParticipationDetails && stats.noParticipationDetails.length > 0 ? `
                    <div style="background: #F3E5F5; border-left: 4px solid #9C27B0; padding: 15px; border-radius: 8px; margin-top: 20px;">
                        <h3 style="margin: 0 0 10px 0; color: #6A1B9A;">👻 Katılım Olmayan Toplantılar (${stats.noParticipationDetails.length})</h3>
                        <p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">Zoom açıldı ama müşteri katılmadı</p>
                        <ul style="margin: 0; padding-left: 20px; color: #666;">
                            ${stats.noParticipationDetails.map(meeting => `
                                <li style="margin: 5px 0;">
                                    <strong>${meeting.name}</strong> - ${meeting.scheduledTime}
                                    <span style="color: #9C27B0;"> → ${Array.isArray(meeting.participants) ? meeting.participants.join(', ') : meeting.participants}</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                    ` : ''}

                    <div style="background: #f8f9fa; padding: 15px; border-radius: 10px; margin-top: 20px;">
                        <p style="margin: 0; text-align: center; color: #666;">
                            💡 Tarih aralığını seçip "Filtrele" butonuna basın
                        </p>
                    </div>
                </div>
            </div>

            <script>
                function applyFilter() {
                    const start = document.getElementById('startDate').value;
                    const end = document.getElementById('endDate').value;
                    const person = document.getElementById('personSelect').value;
                    window.location.href = '/dashboard?start=' + start + '&end=' + end + '&person=' + person;
                }

                function setQuickFilter(days) {
                    const end = new Date();
                    const start = new Date();
                    start.setDate(start.getDate() - days);

                    document.getElementById('startDate').value = start.toISOString().split('T')[0];
                    document.getElementById('endDate').value = end.toISOString().split('T')[0];
                    applyFilter();
                }

                // Kişi değiştiğinde otomatik filtrele
                document.getElementById('personSelect').addEventListener('change', function() {
                    applyFilter();
                });
            </script>
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