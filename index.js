const express = require('express');
const app = express();
const path = require('path');
const sql = require('mssql');
const cron = require('node-cron');
const multer = require('multer');
const bcrypt = require('bcrypt');           // <--- NOU
const session = require('express-session'); // <--- NOU

// --- CONFIGURARE SQL ---
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

// --- CONFIGURARE SESIUNI (NOU) ---
app.use(session({
    secret: 'licenta_secret_key_2026', // Cheia secretă
    resave: false,
    saveUninitialized: false
}));

// --- CONFIGURARE MULTER ---
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

// === MIDDLEWARE DE PROTECȚIE (NOU) ===
// Această funcție păzește paginile. Dacă nu ești logat, te trimite la Login.
function checkAuth(req, res, next) {
    if (req.session.user) {
        next(); // Ești logat, poți trece
    } else {
        res.redirect('/login'); // Stop! Mergi la login.
    }
}

// === RUTE DE AUTENTIFICARE (NOU) ===

// 1. Pagina de Login
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// 2. Acțiunea de Register
app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10); // Criptăm parola
        
        let pool = await sql.connect(dbConfig);
        await pool.request()
            .input('user', sql.NVarChar, username)
            .input('pass', sql.NVarChar, hashedPassword)
            .query("INSERT INTO Users (Username, Password) VALUES (@user, @pass)");
            
        res.render('login', { error: 'Cont creat cu succes! Te poți loga.' });
    } catch (err) {
        res.render('login', { error: 'Eroare: Acest username există deja.' });
    }
});

// 3. Acțiunea de Login
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        let pool = await sql.connect(dbConfig);
        let result = await pool.request()
            .input('user', sql.NVarChar, username)
            .query("SELECT * FROM Users WHERE Username = @user");

        const user = result.recordset[0];

        if (user && await bcrypt.compare(password, user.Password)) {
            req.session.user = user; // Salvăm userul în sesiune
            res.redirect('/');       // Îl trimitem la Dashboard
        } else {
            res.render('login', { error: 'Username sau parolă greșită!' });
        }
    } catch (err) {
        res.send("Eroare server: " + err.message);
    }
});

// 4. Logout
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});


// === RUTELE APLICAȚIEI (TOATE PROTEJATE CU checkAuth) ===

// 1. RUTA PRINCIPALĂ (Dashboard + Filtrare)
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
        let posts = result.recordset.map(post => {
            return {
                id: post.Id, platform: post.Platform, message: post.Message,
                datetime: post.PostDate.toISOString(), status: post.Status,
                image: post.ImagePath, icon: getIcon(post.Platform)
            };
        });

        // Trimitem userul către interfață (req.session.user)
        res.render('index', {
            posts: posts,
            postToEdit: null,
            filters: { platform: platformFilter, status: statusFilter },
            user: req.session.user 
        });

    } catch (err) { console.log(err); res.send("Eroare: " + err.message); }
});

// 2. RUTA EDITARE
app.get('/edit/:id', checkAuth, async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        let resultAll = await pool.request().query('SELECT * FROM Posts ORDER BY PostDate ASC');
        let posts = resultAll.recordset.map(post => ({
            id: post.Id, platform: post.Platform, message: post.Message,
            datetime: post.PostDate.toISOString(), status: post.Status,
            image: post.ImagePath, icon: getIcon(post.Platform)
        }));

        let resultOne = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM Posts WHERE Id = @id');
        let postToEdit = resultOne.recordset[0];
        if (postToEdit) postToEdit.formattedDate = postToEdit.PostDate.toISOString().slice(0, 16);

        res.render('index', { 
            posts: posts, 
            postToEdit: postToEdit, 
            filters: {platform: 'All', status: 'All'},
            user: req.session.user 
        });

    } catch (err) { console.log(err); res.send("Eroare editare: " + err.message); }
});

// 3. RUTA UPDATE
app.post('/update/:id', checkAuth, upload.single('image'), async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        const id = req.params.id;
        if (req.file) {
            await pool.request().input('id', sql.Int, id).input('platform', sql.NVarChar, req.body.platform).input('message', sql.NVarChar, req.body.message).input('postDate', sql.DateTime, new Date(req.body.datetime)).input('imagePath', sql.NVarChar, req.file.filename).query(`UPDATE Posts SET Platform=@platform, Message=@message, PostDate=@postDate, ImagePath=@imagePath WHERE Id=@id`);
        } else {
            await pool.request().input('id', sql.Int, id).input('platform', sql.NVarChar, req.body.platform).input('message', sql.NVarChar, req.body.message).input('postDate', sql.DateTime, new Date(req.body.datetime)).query(`UPDATE Posts SET Platform=@platform, Message=@message, PostDate=@postDate WHERE Id=@id`);
        }
        res.redirect('/');
    } catch (err) { console.log(err); res.send("Eroare la update: " + err.message); }
});

// 4. RUTA CREARE
app.post('/schedule', checkAuth, upload.single('image'), async (req, res) => {
    try {
        const imageFilename = req.file ? req.file.filename : null;
        let pool = await sql.connect(dbConfig);
        await pool.request().input('platform', sql.NVarChar, req.body.platform).input('message', sql.NVarChar, req.body.message).input('postDate', sql.DateTime, new Date(req.body.datetime)).input('imagePath', sql.NVarChar, imageFilename).query("INSERT INTO Posts (Platform, Message, PostDate, Status, ImagePath) VALUES (@platform, @message, @postDate, 'Pending', @imagePath)");
        res.redirect('/');
    } catch (err) { console.log(err); res.send("Eroare: " + err.message); }
});

// 5. RUTA ȘTERGERE
app.post('/delete/:id', checkAuth, async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM Posts WHERE Id = @id');
        res.redirect('/');
    } catch (err) { res.send("Eroare: " + err.message); }
});

// 6. RUTA STATISTICI
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
        res.render('stats', { stats: stats, user: req.session.user });
    } catch (err) { console.log(err); res.send("Eroare statistici: " + err.message); }
});

// 7. RUTA CALENDAR
app.get('/calendar', checkAuth, (req, res) => {
    res.render('calendar', { user: req.session.user });
});

// 8. RUTA API EVENTS
app.get('/api/events', checkAuth, async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        let result = await pool.request().query('SELECT * FROM Posts');
        let events = result.recordset.map(post => {
            let color = '#6c757d';
            if (post.Platform === 'Facebook') color = '#0d6efd';
            if (post.Platform === 'Instagram') color = '#dc3545';
            if (post.Platform === 'LinkedIn') color = '#0dcaf0';
            return {
                title: `${post.Platform}: ${post.Message.substring(0, 20)}...`,
                start: post.PostDate,
                backgroundColor: color, borderColor: color,
                url: `/edit/${post.Id}`
            };
        });
        res.json(events);
    } catch (err) { res.status(500).send(err.message); }
});

// --- ROBOTUL AUTOMAT ---
cron.schedule('* * * * *', async () => {
    try {
        let pool = await sql.connect(dbConfig);
        let result = await pool.request().query("SELECT * FROM Posts WHERE Status = 'Pending' AND PostDate <= GETDATE()");
        const postsToSend = result.recordset;
        if (postsToSend.length > 0) {
            console.log(`🔥 Robot: Trimit ${postsToSend.length} postări...`);
            for (let post of postsToSend) {
                console.log(`🚀 SENT: ${post.Platform} - ${post.Message}`);
                await pool.request().input('id', sql.Int, post.Id).query("UPDATE Posts SET Status = 'Sent' WHERE Id = @id");
            }
        }
    } catch (err) { console.log(err); }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Serverul ruleaza la http://localhost:${PORT}`);
});