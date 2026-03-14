const express = require('express');
const app = express();
const path = require('path');
const sql = require('mssql');
const cron = require('node-cron');
const multer = require('multer');
const bcrypt = require('bcrypt');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

// === CONFIGURARE BAZA DE DATE ===
const dbConfig = {
    user: 'sa',
    password: '123456',
    server: 'ANATOL',
    database: 'SocialScheduler',
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

// CREĂM CONEXIUNEA GLOBALĂ O SINGURĂ DATĂ (Optimizare)
const pool = new sql.ConnectionPool(dbConfig);
const poolConnect = pool.connect()
    .then(() => console.log('✅ Conectat la MS SQL Server!'))
    .catch(err => console.log('❌ Eroare conectare SQL: ', err));

// === CONFIGURARE SESIUNI ===
app.use(session({
    secret: 'licenta_secret_key_2026',
    resave: false,
    saveUninitialized: false
}));

// === CONFIGURARE GOOGLE LOGIN ===
app.use(passport.initialize());

passport.use(new GoogleStrategy({
    clientID: '1054013310746-q2q8iqhmslq1tai584hk52970riij0g4.apps.googleusercontent.com',
    clientSecret: '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',
    callbackURL: "http://localhost:3000/auth/google/callback"
},
    async function (accessToken, refreshToken, profile, cb) {
        try {
            await poolConnect; // Folosim conexiunea globală
            let result = await pool.request()
                .input('googleId', sql.NVarChar, profile.id)
                .query("SELECT * FROM Users WHERE GoogleId = @googleId");

            let user = result.recordset[0];

            if (!user) {
                const email = profile.emails[0].value;
                const username = profile.displayName;
                await pool.request()
                    .input('user', sql.NVarChar, username)
                    .input('email', sql.NVarChar, email)
                    .input('googleId', sql.NVarChar, profile.id)
                    .query("INSERT INTO Users (Username, Email, GoogleId) VALUES (@user, @email, @googleId)");

                let newUserResult = await pool.request()
                    .input('googleId', sql.NVarChar, profile.id)
                    .query("SELECT * FROM Users WHERE GoogleId = @googleId");
                user = newUserResult.recordset[0];
            }
            return cb(null, user);
        } catch (err) { return cb(err, null); }
    }
));

// --- UPLOAD POZE ---
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function getIcon(platform) {
    if (platform === 'Facebook') return 'fab fa-facebook text-primary';
    if (platform === 'LinkedIn') return 'fab fa-linkedin text-info';
    if (platform === 'Instagram') return 'fab fa-instagram text-danger';
    if (platform === 'Twitter') return 'fab fa-twitter text-info';
    return 'fa fa-hashtag';
}

function formatDateManual(dateObj) {
    if (!dateObj) return '';
    const d = new Date(dateObj);
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year = d.getUTCFullYear();
    const hour = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    return `${day}.${month}.${year} ${hour}:${min}`;
}

function formatInputManual(dateObj) {
    if (!dateObj) return '';
    const d = new Date(dateObj);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hour = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${min}`;
}

// === MIDDLEWARE DE PROTECȚIE ===
function checkAuth(req, res, next) {
    if (req.session.user) next(); else res.redirect('/login');
}

// ==============================================
// === RUTE AUTENTIFICARE ===
// ==============================================

app.get('/login', (req, res) => { res.render('login', { error: null }); });

app.post('/register', async (req, res) => {
    try {
        await poolConnect;
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const email = req.body.email;
        const generatedUsername = email.split('@')[0];

        await pool.request()
            .input('user', sql.NVarChar, generatedUsername)
            .input('email', sql.NVarChar, email)
            .input('pass', sql.NVarChar, hashedPassword)
            .query("INSERT INTO Users (Username, Email, Password) VALUES (@user, @email, @pass)");

        res.render('login', { error: 'Cont creat! Te poți loga cu email-ul.' });
    } catch (err) {
        res.render('login', { error: 'Eroare la înregistrare (posibil email existent).' });
    }
});

app.post('/login', async (req, res) => {
    try {
        await poolConnect;
        let result = await pool.request()
            .input('email', sql.NVarChar, req.body.username) // name e username din html
            .query("SELECT * FROM Users WHERE Email = @email");

        const user = result.recordset[0];

        if (user && user.Password && await bcrypt.compare(req.body.password, user.Password)) {
            req.session.user = user;
            res.redirect('/');
        } else {
            res.render('login', { error: 'Email sau parolă incorectă!' });
        }
    } catch (err) { res.send(err.message); }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => { res.redirect('/login'); });
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login', session: false }),
    function (req, res) {
        req.session.user = req.user;
        res.redirect('/');
    });

// ==============================================
// === RUTE APLICAȚIE (DASHBOARD & POSTĂRI) ===
// ==============================================

app.get('/', checkAuth, async (req, res) => {
    try {
        await poolConnect;
        const userId = req.session.user.Id;
        const platformFilter = req.query.platform || 'All';
        const statusFilter = req.query.status || 'All';

        let query = 'SELECT * FROM Posts WHERE UserId = @userId';
        if (platformFilter !== 'All') query += ` AND Platform = '${platformFilter}'`;
        if (statusFilter !== 'All') query += ` AND Status = '${statusFilter}'`;
        query += ' ORDER BY PostDate ASC';

        let result = await pool.request().input('userId', sql.Int, userId).query(query);
        let posts = result.recordset.map(post => ({
            id: post.Id, platform: post.Platform, message: post.Message,
            datetime: formatDateManual(post.PostDate),
            status: post.Status, image: post.ImagePath, icon: getIcon(post.Platform)
        }));

        res.render('index', {
            posts: posts, postToEdit: null,
            filters: { platform: platformFilter, status: statusFilter },
            user: req.session.user, currentPage: 'dashboard'
        });
    } catch (err) { res.send(err.message); }
});

app.get('/edit/:id', checkAuth, async (req, res) => {
    try {
        await poolConnect;
        const userId = req.session.user.Id;

        let resultAll = await pool.request().input('userId', sql.Int, userId).query('SELECT * FROM Posts WHERE UserId = @userId ORDER BY PostDate ASC');
        let posts = resultAll.recordset.map(post => ({
            id: post.Id, platform: post.Platform, message: post.Message,
            datetime: formatDateManual(post.PostDate),
            status: post.Status, image: post.ImagePath, icon: getIcon(post.Platform)
        }));

        let resultOne = await pool.request().input('id', sql.Int, req.params.id).input('userId', sql.Int, userId).query('SELECT * FROM Posts WHERE Id = @id AND UserId = @userId');
        let postToEdit = resultOne.recordset[0];
        if (postToEdit) postToEdit.formattedDate = formatInputManual(postToEdit.PostDate);

        res.render('index', {
            posts: posts, postToEdit: postToEdit,
            filters: { platform: 'All', status: 'All' },
            user: req.session.user, currentPage: 'dashboard'
        });
    } catch (err) { res.send(err.message); }
});

app.post('/schedule', checkAuth, upload.single('image'), async (req, res) => {
    try {
        await poolConnect;
        const imageFilename = req.file ? req.file.filename : null;
        const status = req.body.action === 'draft' ? 'Draft' : 'Pending';
        let cleanDate = req.body.datetime.replace('T', ' ');
        const userId = req.session.user.Id;

        await pool.request()
            .input('platform', sql.NVarChar, req.body.platform)
            .input('message', sql.NVarChar, req.body.message)
            .input('postDate', sql.NVarChar, cleanDate)
            .input('imagePath', sql.NVarChar, imageFilename)
            .input('status', sql.NVarChar, status)
            .input('userId', sql.Int, userId)
            .query("INSERT INTO Posts (Platform, Message, PostDate, Status, ImagePath, UserId) VALUES (@platform, @message, CAST(@postDate AS DATETIME), @status, @imagePath, @userId)");

        res.redirect('/');
    } catch (err) { console.log(err); res.send("Eroare: " + err.message); }
});

app.post('/update/:id', checkAuth, upload.single('image'), async (req, res) => {
    try {
        await poolConnect;
        let cleanDate = req.body.datetime.replace('T', ' ');
        const id = req.params.id;
        const status = req.body.action === 'draft' ? 'Draft' : 'Pending';
        const userId = req.session.user.Id;

        let request = pool.request()
            .input('id', sql.Int, id)
            .input('userId', sql.Int, userId)
            .input('platform', sql.NVarChar, req.body.platform)
            .input('message', sql.NVarChar, req.body.message)
            .input('postDate', sql.NVarChar, cleanDate)
            .input('status', sql.NVarChar, status);

        if (req.file) {
            request.input('imagePath', sql.NVarChar, req.file.filename);
            await request.query(`UPDATE Posts SET Platform=@platform, Message=@message, PostDate=CAST(@postDate AS DATETIME), ImagePath=@imagePath, Status=@status WHERE Id=@id AND UserId=@userId`);
        } else {
            await request.query(`UPDATE Posts SET Platform=@platform, Message=@message, PostDate=CAST(@postDate AS DATETIME), Status=@status WHERE Id=@id AND UserId=@userId`);
        }
        res.redirect('/');
    } catch (err) { res.send("Eroare update: " + err.message); }
});

app.post('/delete/:id', checkAuth, async (req, res) => {
    try {
        await poolConnect;
        await pool.request().input('id', sql.Int, req.params.id).input('userId', sql.Int, req.session.user.Id).query('DELETE FROM Posts WHERE Id = @id AND UserId = @userId');
        res.redirect('/');
    } catch (err) { res.send(err.message); }
});

// ==============================================
// === STATISTICI, CALENDAR, CONTURI ===
// ==============================================

app.get('/calendar', checkAuth, (req, res) => {
    res.render('calendar', { user: req.session.user, currentPage: 'calendar' });
});

app.get('/stats', checkAuth, async (req, res) => {
    try {
        await poolConnect;
        let result = await pool.request().input('userId', sql.Int, req.session.user.Id).query('SELECT * FROM Posts WHERE UserId = @userId');
        let posts = result.recordset;
        let stats = {
            total: posts.length,
            facebook: posts.filter(p => p.Platform === 'Facebook').length,
            instagram: posts.filter(p => p.Platform === 'Instagram').length,
            linkedin: posts.filter(p => p.Platform === 'LinkedIn').length,
            twitter: posts.filter(p => p.Platform === 'Twitter').length,
            sent: posts.filter(p => p.Status === 'Sent').length,
            pending: posts.filter(p => p.Status === 'Pending').length
        };
        res.render('stats', { stats: stats, user: req.session.user, currentPage: 'stats' });
    } catch (err) { res.send("Eroare: " + err.message); }
});

app.get('/api/events', checkAuth, async (req, res) => {
    try {
        await poolConnect;
        let result = await pool.request().input('userId', sql.Int, req.session.user.Id).query('SELECT * FROM Posts WHERE UserId = @userId');
        let events = result.recordset.map(post => {
            let color = '#6c757d';
            if (post.Platform === 'Facebook') color = '#0d6efd';
            if (post.Platform === 'Instagram') color = '#dc3545';
            if (post.Platform === 'LinkedIn') color = '#0dcaf0';
            if (post.Platform === 'Twitter') color = '#000000';
            if (post.Status === 'Draft') color = '#adb5bd';

            return {
                title: `${post.Platform}: ${post.Message.substring(0, 20)}...`,
                start: formatInputManual(post.PostDate),
                backgroundColor: color, borderColor: color,
                url: `/edit/${post.Id}`
            };
        });
        res.json(events);
    } catch (err) { res.status(500).send(err.message); }
});

// ==============================================
// === CONTURI & CREDENȚIALE API ===
// ==============================================

app.get('/accounts', checkAuth, async (req, res) => {
    try {
        await poolConnect;
        const userId = req.session.user.Id;

        // Preluăm cheile din baza de date pentru pagina de Conturi
        let result = await pool.request()
            .input('userId', sql.Int, userId)
            .query('SELECT * FROM SocialCredentials WHERE UserId = @userId');

        let credentials = result.recordset[0] || {};

        res.render('accounts', {
            user: req.session.user,
            currentPage: 'accounts',
            credentials: credentials
        });
    } catch (err) { res.send("Eroare la încărcarea conturilor: " + err.message); }
});

app.post('/accounts/api-credentials', checkAuth, async (req, res) => {
    try {
        await poolConnect;
        const userId = req.session.user.Id;

        const { TwAccountId, TwApiKey, TwApiSecret, TwAccessToken, TwAccessSecret, FbAppId, FbPageId, FbAppSecret, FbAccessToken } = req.body;
        const TwAutoPost = req.body.TwAutoPost === '1' ? 1 : 0;
        const FbAutoPost = req.body.FbAutoPost === '1' ? 1 : 0;

        let check = await pool.request().input('userId', sql.Int, userId).query('SELECT UserId FROM SocialCredentials WHERE UserId = @userId');

        let request = pool.request()
            .input('userId', sql.Int, userId)
            .input('TwAccountId', sql.NVarChar, TwAccountId || '')
            .input('TwApiKey', sql.NVarChar, TwApiKey || '')
            .input('TwApiSecret', sql.NVarChar, TwApiSecret || '')
            .input('TwAccessToken', sql.NVarChar, TwAccessToken || '')
            .input('TwAccessSecret', sql.NVarChar, TwAccessSecret || '')
            .input('TwAutoPost', sql.Bit, TwAutoPost)
            .input('FbAppId', sql.NVarChar, FbAppId || '')
            .input('FbPageId', sql.NVarChar, FbPageId || '')
            .input('FbAppSecret', sql.NVarChar, FbAppSecret || '')
            .input('FbAccessToken', sql.NVarChar, FbAccessToken || '')
            .input('FbAutoPost', sql.Bit, FbAutoPost);

        if (check.recordset.length > 0) {
            await request.query(`UPDATE SocialCredentials SET TwAccountId=@TwAccountId, TwApiKey=@TwApiKey, TwApiSecret=@TwApiSecret, TwAccessToken=@TwAccessToken, TwAccessSecret=@TwAccessSecret, TwAutoPost=@TwAutoPost, FbAppId=@FbAppId, FbPageId=@FbPageId, FbAppSecret=@FbAppSecret, FbAccessToken=@FbAccessToken, FbAutoPost=@FbAutoPost WHERE UserId=@userId`);
        } else {
            await request.query(`INSERT INTO SocialCredentials (UserId, TwAccountId, TwApiKey, TwApiSecret, TwAccessToken, TwAccessSecret, TwAutoPost, FbAppId, FbPageId, FbAppSecret, FbAccessToken, FbAutoPost) VALUES (@userId, @TwAccountId, @TwApiKey, @TwApiSecret, @TwAccessToken, @TwAccessSecret, @TwAutoPost, @FbAppId, @FbPageId, @FbAppSecret, @FbAccessToken, @FbAutoPost)`);
        }
        res.redirect('/accounts'); // Redirecționează înapoi la conturi
    } catch (err) { res.send("Eroare la salvarea credențialelor API: " + err.message); }
});

// ==============================================
// === SETĂRI DE PROFIL ===
// ==============================================

app.get('/settings', checkAuth, (req, res) => {
    // Pagina de setări este acum doar pentru modificarea profilului (nume, parolă)
    res.render('settings', { user: req.session.user, currentPage: 'settings' });
});

app.post('/settings/update', checkAuth, async (req, res) => {
    try {
        await poolConnect;
        const { username, password } = req.body;
        const userId = req.session.user.Id;

        if (password && password.trim() !== "") {
            const hashedPassword = await bcrypt.hash(password, 10);
            await pool.request().input('id', sql.Int, userId).input('user', sql.NVarChar, username).input('pass', sql.NVarChar, hashedPassword).query("UPDATE Users SET Username = @user, Password = @pass WHERE Id = @id");
        } else {
            await pool.request().input('id', sql.Int, userId).input('user', sql.NVarChar, username).query("UPDATE Users SET Username = @user WHERE Id = @id");
        }
        req.session.user.Username = username;
        res.redirect('/settings');
    } catch (err) { res.send("Eroare la actualizare: " + err.message); }
});

// ==============================================
//               ROBOTUL SIMULATOR 🤖
// ==============================================
cron.schedule('* * * * *', async () => {
    try {
        await poolConnect;

        // INTEROGARE NOUĂ: Aducem postările Pending, DAR le "lipim" de credențialele utilizatorului care le-a creat
        let query = `
            SELECT p.*, 
                   c.TwApiKey, c.TwApiSecret, c.TwAccessToken, c.TwAutoPost,
                   c.FbAppId, c.FbAccessToken, c.FbAutoPost
            FROM Posts p
            LEFT JOIN SocialCredentials c ON p.UserId = c.UserId
            WHERE p.Status = 'Pending' AND p.PostDate <= GETDATE()
        `;
        let result = await pool.request().query(query);
        const postsToSend = result.recordset;

        if (postsToSend.length > 0) {
            console.log(`🔥 [ROBOT] Am găsit ${postsToSend.length} postări de trimis.`);

            for (let post of postsToSend) {
                console.log(`📡 [PROCESARE] Postarea ${post.Id} pentru ${post.Platform}...`);

                // SIMULARE VERIFICARE CHEI TWITTER
                if (post.Platform === 'Twitter') {
                    if (post.TwAutoPost && post.TwApiKey && post.TwAccessToken) {
                        console.log(`🔑 Folosim cheile Twitter setate de UserID: ${post.UserId}`);
                        // Aici va veni integrată logica reală cu SDK-ul de la Twitter
                    } else {
                        console.log(`⚠️ UserID ${post.UserId} NU a activat AutoPost sau nu are cheile complete pentru Twitter.`);
                    }
                }

                // SIMULARE VERIFICARE CHEI FACEBOOK
                if (post.Platform === 'Facebook') {
                    if (post.FbAutoPost && post.FbAccessToken) {
                        console.log(`🔑 Folosim Access Token-ul Facebook setat de UserID: ${post.UserId}`);
                        // Aici va veni integrată logica reală cu axios pentru Graph API
                    } else {
                        console.log(`⚠️ UserID ${post.UserId} NU a activat AutoPost sau nu are token-ul pentru Facebook.`);
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 2000));
                console.log(`✅ [SUCCES] Postarea ${post.Id} a fost publicată pe ${post.Platform}!`);

                await pool.request().input('id', sql.Int, post.Id).query("UPDATE Posts SET Status = 'Sent' WHERE Id = @id");
            }
        }
    } catch (err) { console.log("Eroare Robot:", err); }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Serverul SocialScheduler ruleaza la http://localhost:${PORT}`);
});