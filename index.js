const express = require('express');
const app = express();
const path = require('path');
const sql = require('mssql');
const cron = require('node-cron');
const multer = require('multer');
const bcrypt = require('bcrypt');
const session = require('express-session');

// --- CONFIGURARE BAZA DE DATE ---
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

// --- CONFIGURARE SESIUNI ---
app.use(session({
    secret: 'licenta_secret_key_2026',
    resave: false,
    saveUninitialized: false
}));

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

// === FUNCȚII DE FORMATARE A OREI ===
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

// === RUTE AUTENTIFICARE ===
app.get('/login', (req, res) => { res.render('login', { error: null }); });

app.post('/register', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        let pool = await sql.connect(dbConfig);
        await pool.request().input('user', sql.NVarChar, req.body.username).input('pass', sql.NVarChar, hashedPassword).query("INSERT INTO Users (Username, Password) VALUES (@user, @pass)");
        res.render('login', { error: 'Cont creat! Te poți loga.' });
    } catch (err) { res.render('login', { error: 'User existent.' }); }
});

app.post('/login', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        let result = await pool.request().input('user', sql.NVarChar, req.body.username).query("SELECT * FROM Users WHERE Username = @user");
        const user = result.recordset[0];
        if (user && await bcrypt.compare(req.body.password, user.Password)) {
            req.session.user = user; res.redirect('/');
        } else { res.render('login', { error: 'Date incorecte!' }); }
    } catch (err) { res.send(err.message); }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// === RUTE APLICAȚIE ===

//  DASHBOARD
app.get('/', checkAuth, async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        const platformFilter = req.query.platform || 'All';
        const statusFilter = req.query.status || 'All';
        let query = 'SELECT * FROM Posts WHERE 1=1';
        if (platformFilter !== 'All') query += ` AND Platform = '${platformFilter}'`;
        if (statusFilter !== 'All') query += ` AND Status = '${statusFilter}'`;
        query += ' ORDER BY PostDate ASC';

        let result = await pool.request().query(query);
        let posts = result.recordset.map(post => ({
            id: post.Id, platform: post.Platform, message: post.Message,
            datetime: formatDateManual(post.PostDate),
            status: post.Status, image: post.ImagePath, icon: getIcon(post.Platform)
        }));

        res.render('index', {
            posts: posts,
            postToEdit: null,
            filters: { platform: platformFilter, status: statusFilter },
            user: req.session.user,
            currentPage: 'dashboard'
        });
    } catch (err) { res.send(err.message); }
});

// EDITARE
app.get('/edit/:id', checkAuth, async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        let resultAll = await pool.request().query('SELECT * FROM Posts ORDER BY PostDate ASC');
        let posts = resultAll.recordset.map(post => ({
            id: post.Id, platform: post.Platform, message: post.Message,
            datetime: formatDateManual(post.PostDate),
            status: post.Status, image: post.ImagePath, icon: getIcon(post.Platform)
        }));
        let resultOne = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM Posts WHERE Id = @id');
        let postToEdit = resultOne.recordset[0];
        if (postToEdit) postToEdit.formattedDate = formatInputManual(postToEdit.PostDate);

        res.render('index', {
            posts: posts,
            postToEdit: postToEdit,
            filters: { platform: 'All', status: 'All' },
            user: req.session.user,
            currentPage: 'dashboard'
        });
    } catch (err) { res.send(err.message); }
});

// SALVARE
app.post('/schedule', checkAuth, upload.single('image'), async (req, res) => {
    try {
        const imageFilename = req.file ? req.file.filename : null;
        let pool = await sql.connect(dbConfig);
        let cleanDate = req.body.datetime.replace('T', ' ');

        await pool.request()
            .input('platform', sql.NVarChar, req.body.platform)
            .input('message', sql.NVarChar, req.body.message)
            .input('postDate', sql.NVarChar, cleanDate)
            .input('imagePath', sql.NVarChar, imageFilename)
            .query("INSERT INTO Posts (Platform, Message, PostDate, Status, ImagePath) VALUES (@platform, @message, CAST(@postDate AS DATETIME), 'Pending', @imagePath)");
        res.redirect('/');
    } catch (err) { console.log(err); res.send("Eroare: " + err.message); }
});

app.post('/update/:id', checkAuth, upload.single('image'), async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        let cleanDate = req.body.datetime.replace('T', ' ');
        const id = req.params.id;
        if (req.file) {
            await pool.request().input('id', sql.Int, id).input('platform', sql.NVarChar, req.body.platform).input('message', sql.NVarChar, req.body.message).input('postDate', sql.NVarChar, cleanDate).input('imagePath', sql.NVarChar, req.file.filename).query(`UPDATE Posts SET Platform=@platform, Message=@message, PostDate=CAST(@postDate AS DATETIME), ImagePath=@imagePath WHERE Id=@id`);
        } else {
            await pool.request().input('id', sql.Int, id).input('platform', sql.NVarChar, req.body.platform).input('message', sql.NVarChar, req.body.message).input('postDate', sql.NVarChar, cleanDate).query(`UPDATE Posts SET Platform=@platform, Message=@message, PostDate=CAST(@postDate AS DATETIME) WHERE Id=@id`);
        }
        res.redirect('/');
    } catch (err) { res.send("Eroare update: " + err.message); }
});

app.post('/delete/:id', checkAuth, async (req, res) => {
    try { let pool = await sql.connect(dbConfig); await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM Posts WHERE Id = @id'); res.redirect('/'); } catch (err) { res.send(err.message); }
});

// CALENDAR
app.get('/calendar', checkAuth, (req, res) => {
    res.render('calendar', {
        user: req.session.user,
        currentPage: 'calendar' // <--- IDENTIFICATOR PAGINĂ
    });
});

// STATISTICI
app.get('/stats', checkAuth, async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        let result = await pool.request().query('SELECT * FROM Posts');
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
        res.render('stats', {
            stats: stats,
            user: req.session.user,
            currentPage: 'stats'
        });
    } catch (err) { res.send("Eroare: " + err.message); }
});

app.get('/api/events', checkAuth, async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        let result = await pool.request().query('SELECT * FROM Posts');
        let events = result.recordset.map(post => {
            let color = '#6c757d';
            if (post.Platform === 'Facebook') color = '#0d6efd';
            if (post.Platform === 'Instagram') color = '#dc3545';
            if (post.Platform === 'LinkedIn') color = '#0dcaf0';
            if (post.Platform === 'Twitter') color = '#000000';
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

// CONTURI (ACCOUNTS)
app.get('/accounts', checkAuth, (req, res) => {
    res.render('accounts', {
        user: req.session.user,
        currentPage: 'accounts' // <--- Pentru meniul inteligent
    });
});

// SETĂRI (SETTINGS) - AFIȘARE
app.get('/settings', checkAuth, (req, res) => {
    res.render('settings', {
        user: req.session.user,
        currentPage: 'settings'
    });
});

// SETĂRI - SALVARE MODIFICĂRI
app.post('/settings/update', checkAuth, async (req, res) => {
    try {
        const { username, password } = req.body;
        const userId = req.session.user.Id;

        let pool = await sql.connect(dbConfig);

        // Dacă s-a introdus o parolă nouă, o criptăm
        if (password && password.trim() !== "") {
            const hashedPassword = await bcrypt.hash(password, 10);

            await pool.request()
                .input('id', sql.Int, userId)
                .input('user', sql.NVarChar, username)
                .input('pass', sql.NVarChar, hashedPassword)
                .query("UPDATE Users SET Username = @user, Password = @pass WHERE Id = @id");
        } else {
            // Dacă nu a schimbat parola, actualizăm doar numele
            await pool.request()
                .input('id', sql.Int, userId)
                .input('user', sql.NVarChar, username)
                .query("UPDATE Users SET Username = @user WHERE Id = @id");
        }

        // Actualizăm sesiunea cu noile date
        req.session.user.Username = username;

        res.redirect('/');
    } catch (err) { res.send("Eroare la actualizare: " + err.message); }
});

// ==============================================
//               ROBOTUL SIMULATOR 🤖
// ==============================================
cron.schedule('* * * * *', async () => {
    try {
        let pool = await sql.connect(dbConfig);
        let result = await pool.request().query("SELECT * FROM Posts WHERE Status = 'Pending' AND PostDate <= GETDATE()");
        const postsToSend = result.recordset;

        if (postsToSend.length > 0) {
            console.log(`🔥 [ROBOT] Am găsit ${postsToSend.length} postări de trimis.`);
            for (let post of postsToSend) {
                console.log(`📡 [SIMULARE] Conectare la API ${post.Platform}...`);
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