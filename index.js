const express = require('express');
const app = express();
const path = require('path');
const sql = require('mssql');
const cron = require('node-cron'); // <--- IMPORTĂM ROBOTUL

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

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function getIcon(platform) {
    if(platform === 'Facebook') return 'fab fa-facebook text-primary';
    if(platform === 'LinkedIn') return 'fab fa-linkedin text-info';
    if(platform === 'Instagram') return 'fab fa-instagram text-danger';
    if(platform === 'Twitter') return 'fab fa-twitter text-info';
    return 'fa fa-hashtag';
}

// --- RUTELE APLICAȚIEI ---

app.get('/', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        // Luăm doar postările care NU au fost trimise încă, sau toate, cum preferi
        let result = await pool.request().query('SELECT * FROM Posts ORDER BY PostDate ASC');
        
        let posts = result.recordset.map(post => {
            return {
                id: post.Id,
                platform: post.Platform,
                message: post.Message,
                datetime: post.PostDate.toISOString(),
                status: post.Status, // <--- Trimitem și statusul la interfață
                icon: getIcon(post.Platform)
            };
        });

        res.render('index', { posts: posts });
    } catch (err) {
        console.log(err);
        res.send("Eroare: " + err.message);
    }
});

app.post('/schedule', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        await pool.request()
            .input('platform', sql.NVarChar, req.body.platform)
            .input('message', sql.NVarChar, req.body.message)
            .input('postDate', sql.DateTime, new Date(req.body.datetime))
            .query("INSERT INTO Posts (Platform, Message, PostDate, Status) VALUES (@platform, @message, @postDate, 'Pending')");
            
        res.redirect('/');
    } catch (err) {
        console.log(err);
        res.send("Eroare: " + err.message);
    }
});

app.post('/delete/:id', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM Posts WHERE Id = @id');
        res.redirect('/');
    } catch (err) {
        res.send("Eroare: " + err.message);
    }
});

// --- ROBOTUL AUTOMAT (CRON JOB) ---
// Rulează în fiecare minut ('* * * * *')
cron.schedule('* * * * *', async () => {
    console.log('🤖 Robot: Verific dacă sunt postări de trimis...');
    
    try {
        let pool = await sql.connect(dbConfig);
        
        // 1. Căutăm postări care sunt 'Pending' ȘI au timpul trecut sau egal cu acum
        let result = await pool.request()
            .query("SELECT * FROM Posts WHERE Status = 'Pending' AND PostDate <= GETDATE()");
            
        const postsToSend = result.recordset;

        if (postsToSend.length > 0) {
            console.log(`🔥 Am găsit ${postsToSend.length} postări de trimis!`);

            // 2. Le "trimitem" pe rând
            for (let post of postsToSend) {
                // AICI VA VENI CODUL REAL PENTRU FACEBOOK API MAI TÂRZIU
                console.log(`------------------------------------------------`);
                console.log(`🚀 TRIMITERE CĂTRE: ${post.Platform}`);
                console.log(`📄 MESAJ: ${post.Message}`);
                console.log(`------------------------------------------------`);

                // 3. Actualizăm statusul în 'Sent' ca să nu o mai trimitem iar
                await pool.request()
                    .input('id', sql.Int, post.Id)
                    .query("UPDATE Posts SET Status = 'Sent' WHERE Id = @id");
            }
        }
    } catch (err) {
        console.log("Eroare la Cron Job:", err);
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Serverul ruleaza la http://localhost:${PORT}`);
});