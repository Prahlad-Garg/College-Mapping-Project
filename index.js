import express from "express";
import { dirname } from "path";
import { fileURLToPath } from "url";
import env from "dotenv";
import bcrypt from "bcrypt";
import session from "express-session";
import passport, { Passport } from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import admin from "firebase-admin";
import { readFileSync } from "fs";
import nodemailer from "nodemailer";
import flash from "connect-flash";

env.config();

//NODEMAILER
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // false for 587, true for 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.PASSKEY,
  }
});

//firebase
const serviceAccount = JSON.parse(readFileSync("./college-mapping-819a7-firebase-adminsdk-fbsvc-9ac784fcdd.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const port = 3000;
import pkg from 'pg';
import fetch from "node-fetch";

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());



app.use(session({
  secret: process.env.SECRET,
  resave: false,
  saveUninitialized: true,
  cookie:{
    maxAge: 1000 * 60 * 60 * 24, // ms * sec * min * hour 
  }
}))
app.use(flash());
app.use(passport.initialize());
app.use(passport.session());


//constants
const chatHistory = {}; // stores history per user
const saltRounds = 10;

const { Pool } = pkg;
const pool = new Pool({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT,
});

// Use static/css files
app.use(express.static("public"));

// Render homepage
app.get("/",(req,res)=>{
        res.render("index.ejs");
});

// navbar buttons have href="/about" and "/contact" so we make 2 pages to handle those routes
app.get("/about",(req,res)=>{
    if(req.isAuthenticated()){
        res.render("about.ejs");
    } else {
        res.redirect("/login");
    }
});

app.get("/contact",(req,res)=>{
    if(req.isAuthenticated()){
        res.render("contact.ejs");
    } else {
        res.redirect("/login");
    }
});

app.post("/contact", async(req,res) => {
    const data = req.body;

    try{
        const result = await pool.query("INSERT INTO queries (name, email, message) VALUES ($1,$2,$3)",[data.name,data.email,data.text]);
        res.redirect("/");
    } catch (err) {
        console.log(err);
    }
});

app.get("/queries", async (req, res) => {
    if(req.isAuthenticated()){
        try {
            const result = await pool.query("SELECT * FROM queries ORDER BY id DESC");
            res.render("queries.ejs", { queries: result.rows });
        } catch (err) {
            console.log(err);
        }
    } else {
        res.redirect("/login");
    }
});

app.get("/query/:id", async (req, res) => {
    if(req.isAuthenticated()){
        const id = req.params.id;

        try {
            const result = await pool.query("SELECT * FROM queries WHERE id = $1", [id]);
            res.render("queryDetail.ejs", { query: result.rows[0] });
        } catch (err) {
            console.log(err);
        }
    } else {
        res.redirect("/login");
    }       
});

app.post("/delete/:id", async (req, res) => {
  const id = req.params.id;

  try {
    await pool.query("DELETE FROM queries WHERE id = $1", [id]);
    res.redirect("/queries");
  } catch (err) {
    console.log(err);
  }
});

// LOGIN AND LOGOUT ROUTES

app.get("/logout", (req, res, next) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

app.get("/auth/google", passport.authenticate("google",{     //passport.authenticate("STRATEGY_NAME")
    scope: ["profile","email"],
  })
);    

app.get("/auth/google/callback", passport.authenticate("google", {
    successRedirect:"/",
    failureRedirect: "/login",
  })
);  

app.get("/login", (req, res) => {
  res.render("login.ejs", { error: req.flash("error") });
});

app.get("/register", (req, res) => {
  res.render("register.ejs");
});

app.post("/register", async (req, res) => {
  const email = req.body.username;
  const password = req.body.password;

  // Domain restriction
  if (!email.endsWith("@pec.edu.in")) {
    return res.send("Only @pec.edu.in email addresses are allowed.");
  }

  try {
    // Check if already in DB
    const checkResult = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (checkResult.rows.length > 0) {
      return res.send("Email already exists. Try logging in.");
    }

    // Clean up ghost Firebase user if exists
    try {
      const existingFirebaseUser = await admin.auth().getUserByEmail(email);
      await admin.auth().deleteUser(existingFirebaseUser.uid);
      console.log("Deleted ghost Firebase user for:", email);
    } catch (ghostErr) {
      // No ghost user — fine, continue
    }

    // Create fresh Firebase user
    const firebaseUser = await admin.auth().createUser({
      email: email,
      password: password,
      emailVerified: false,
    });

    // Generate verification link
    const verificationLink = await admin.auth().generateEmailVerificationLink(email);

    // Hash password
    bcrypt.hash(password, saltRounds, async (err, hash) => {
      if (err) {
        await admin.auth().deleteUser(firebaseUser.uid);
        return res.send("Registration failed. Please try again.");
      }

      try {
        // Insert into DB
        const result = await pool.query(
          "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
          [email, hash]
        );

        const user = result.rows[0];

        // Try sending email — if it fails, roll back everything
        try {
          await transporter.sendMail({
            from: `"PEC Router" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Verify your PEC Router account",
            html: `
              <div style="font-family: sans-serif; max-width: 500px; margin: auto;">
                <h2>Verify your email</h2>
                <p>Click the button below to verify your <b>@pec.edu.in</b> account:</p>
                <a href="${verificationLink}" 
                   style="display:inline-block; padding:12px 24px; background:#3586ff; 
                          color:white; border-radius:6px; text-decoration:none; font-weight:bold;">
                  Verify Email
                </a>
                <p style="color:grey; font-size:12px; margin-top:20px;">
                  If you didn't register, ignore this email.
                </p>
              </div>
            `
          });

          console.log("Verification email sent to", email);

          // All good — log user in
          req.login(user, (err) => {
            if (err) console.log(err);
            res.send("Registration successful! Please check your @pec.edu.in email to verify your account before logging in.");
          });

        } catch (mailErr) {
          // Email failed — roll back DB and Firebase
          await pool.query("DELETE FROM users WHERE email = $1", [email]);
          await admin.auth().deleteUser(firebaseUser.uid);
          console.log("Mail failed, rolled back:", mailErr);
          return res.send("Failed to send verification email. Please try again.");
        }

      } catch (dbErr) {
        // DB insert failed — roll back Firebase
        await admin.auth().deleteUser(firebaseUser.uid);
        await pool.query("DELETE FROM users WHERE email = $1", [email]); // safety cleanup
        console.log(dbErr);
        return res.send("Registration failed. Please try again.");
      }
    });

  } catch (err) {
    if (err.code === "auth/invalid-email") {
      return res.send("Invalid email address.");
    }
    console.log(err);
    res.send("Registration failed.");
  }
});

// NEW middleware — checks Firebase email verification before login
async function checkEmailVerified(req, res, next) {
  const email = req.body.username;
  if (!email) return next();

  try {
    const firebaseUser = await admin.auth().getUserByEmail(email);
    if (!firebaseUser.emailVerified) {
      req.flash("error", "Please verify your email before logging in. Check your @pec.edu.in inbox.");
      return res.redirect("/login");  // redirect with flash instead of res.send
    }
    next();
  } catch (err) {
    next();
  }
}

app.post("/login", checkEmailVerified, passport.authenticate("local", {
  successRedirect: "/",
  failureRedirect: "/login",
  failureFlash: true  // enables flash messages
}));


passport.use("local",
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await pool.query("SELECT * FROM users WHERE email = $1", [username]);
      
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, result) => {
          if (err) return cb(err);
          if (result) {
            return cb(null, user);
          } else {
            return cb(null, false, { message: "Incorrect password." }); // error message
          }
        });
      } else {
        return cb(null, false, { message: "No account found with that email." }); // error message
      }
    } catch (err) {
      return cb(err);
    }
  })
);

passport.use(       
  "google",   // STRATEGY_NAME
  new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.CALLBACKURL,
      userProfileURL: process.env.USERPROFILEURL,
    }, 
    async (accessToken, refreshToken, profile, cb) => {
        try {
        console.log(profile);
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [
          profile.email,
        ]);
        if (result.rows.length === 0) {
          const newUser = await pool.query(
            "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
            [profile.email, "google"]
          );
          return cb(null, newUser.rows[0]);
        } else {
          return cb(null, result.rows[0]);
        }
      } catch (err) {
        return cb(err);
      }
    })
  
);

//saves user data to local storage i.e cookies
passport.serializeUser((user, cb) =>{
  cb(null, user);
});

passport.deserializeUser((user, cb) =>{
  cb(null, user);
});


app.get("/map",(req,res)=>{
    if(req.isAuthenticated()){
        res.sendFile(__dirname + "/public/out3.html");
    } else {
        res.redirect("/login");
    }
});

//AI CHATBOT INTERFACE

app.get('/schedules', (req, res) => {
    if(req.isAuthenticated()){
        res.render('chat');
    } else {
        res.redirect("/login");
    }
});


app.post('/chat', async (req, res) => {
    const userMsg = req.body.message;
    const userId = req.ip;

    // INIT HISTORY
    if (!chatHistory[userId]) {
        chatHistory[userId] = [];
    }

    // ADD USER MESSAGE
    chatHistory[userId].push({
        role: "user",
        content: userMsg
    });

    // KEEP LAST 10
    if (chatHistory[userId].length > 10) {
        chatHistory[userId].shift();
    }

    // USE LAST 5 FOR PROMPT (better)
    const historyText = chatHistory[userId]
        .slice(-5)
        .map(m => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n");

    try {
        // STEP 1: CLASSIFY USER INPUT (SQL or CHAT)
        const classifyRes = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'qwen2.5:1.5b',
                prompt: `
You are classifying user input for a timetable system.

Reply ONLY with:
- SQL → if the question is about timetable, classes, schedule, rooms, faculty, branches, or semesters
- CHAT → for greetings or general conversation

Examples:

"hello" → CHAT
"what can you do" → CHAT
"show monday schedule" → SQL
"does ai branch have class on monday" → SQL
"free rooms after 2pm" → SQL

Conversation history:
${historyText}

User input: ${userMsg}
                `,
                stream: false
            })
        });

        const classifyData = await classifyRes.json();
        const type = (classifyData.response || "").trim().toUpperCase();

        console.log("TYPE:", type);
        
        const dbKeywords = [
            "class", "schedule", "timetable", "room",
            "faculty", "branch", "semester", "subject",
            "monday", "tuesday", "wednesday", "thursday", "friday"
        ];

        const isLikelyDB = dbKeywords.some(word =>
            userMsg.toLowerCase().includes(word)
        );

        // STEP 2: HANDLE NORMAL CHAT
        //http://localhost:11434/api/generate
        if (type === "CHAT" && !isLikelyDB) {
            const chatRes = await fetch('http://localhost:11434/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'qwen2.5:1.5b',
                    prompt: `
You are a helpful timetable assistant.
Conversation history:
${historyText}
User: ${userMsg}
                    `,
                    stream: false
                })
            });

            const chatData = await chatRes.json();

            // SAVE RESPONSE
            chatHistory[userId].push({
                role: "assistant",
                content: chatData.response
            });

            if (chatHistory[userId].length > 10) {
                chatHistory[userId].shift();
            }
                        
            return res.json({
                reply: chatData.response || "Hey! Ask me about schedules, rooms, or faculty 🙂"
            });
        }

        //STEP 3: GENERATE SQL (only if SQL type)
        const aiRes = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'qwen2.5:1.5b',
                prompt: `
You are a PostgreSQL expert.

Convert the user's question into ONLY a valid SQL query.
Do NOT explain anything.
Do NOT add extra text.
Return ONLY the SQL query.

---

DATABASE SCHEMA:

branches(id PRIMARY KEY, branch_name)
faculty(id PRIMARY KEY, name)
rooms(id PRIMARY KEY, room_code)
semesters(id PRIMARY KEY, semester_number)
subjects(id PRIMARY KEY, subject_name)
timetable(id PRIMARY KEY, room_id INT, subject_id INT, faculty_id INT, branch_id INT, day_of_week INT, start_time TIME, end_time TIME, semester_id INT)

---

RELATIONSHIPS (FOREIGN KEYS):

timetable.room_id → rooms.id
timetable.subject_id → subjects.id
timetable.faculty_id → faculty.id
timetable.branch_id → branches.id
timetable.semester_id → semesters.id

---

IMPORTANT RULES:

* NEVER use SELECT *

* ALWAYS return meaningful columns (names, not IDs)

* ALWAYS JOIN tables to get readable data:
  JOIN branches → branch_name
  JOIN subjects → subject_name
  JOIN faculty → faculty.name
  JOIN rooms → room_code

* ALWAYS SELECT like:
  branch_name, subject_name, faculty.name AS faculty_name, room_code,
  day_of_week, start_time, end_time

---

TEXT MATCHING:

* ALWAYS use ILIKE '%value%' for text matching
* NEVER use LOWER() with LIKE

Examples:
branch_name ILIKE '%ai%'
subject_name ILIKE '%dav%'

---

DATE & TIME RULES:

* day_of_week: 1 = Monday, ..., 7 = Sunday

* start_time and end_time are TIME type

* When checking a specific time:
  ALWAYS use:
  start_time <= 'HH:MM:SS'::time
  AND end_time > 'HH:MM:SS'::time

---

EXAMPLES:

User: show AI monday classes

SELECT
  b.branch_name,
  s.subject_name,
  f.name AS faculty_name,
  r.room_code,
  t.day_of_week,
  t.start_time,
  t.end_time
FROM timetable t
JOIN branches b ON t.branch_id = b.id
JOIN subjects s ON t.subject_id = s.id
JOIN faculty f ON t.faculty_id = f.id
JOIN rooms r ON t.room_id = r.id
WHERE b.branch_name ILIKE '%ai%'
  AND t.day_of_week = 1;
Conversation history:
${historyText}  
User question: ${userMsg}
                `,
                stream: false
            })
        });

        const aiData = await aiRes.json();

        // STEP 4: SAFE EXTRACTION
        const raw = (aiData.response || "").trim();

        if (!raw) {
            return res.json({ reply: "Couldn't generate SQL. Try rephrasing." });
        }

        const match = raw.match(/select[\s\S]*;/i);
        let sqlQuery = match ? match[0] : raw;
        
        //  FIX ; before LIMIT
        // remove existing semicolon (if any)
        sqlQuery = sqlQuery.replace(/;+\s*$/, "");

        // add LIMIT + semicolon at the end
        if (!/limit\s+\d+/i.test(sqlQuery)) {
            sqlQuery += " LIMIT 50";
        }

        // finally add semicolon
        sqlQuery += ";";

        console.log("SQL:", sqlQuery);

        // STEP 6: FINAL VALIDATION
        if (!sqlQuery.toLowerCase().includes("select")) {
            return res.json({ reply: "Invalid query generated." });
        }

        // STEP 7: RUN QUERY
        const dbRes = await pool.query(sqlQuery);
        
        // STEP 8: EXPLAIN RESULT
        const finalRes = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'qwen2.5:1.5b',
                prompt: `

IMPORTANT NOTES:
* Use ONLY the data provided in "Database result"
* DO NOT guess or change times
* DO NOT make up values

Conversation history:
${historyText}
User asked: ${userMsg}

Database result:
${JSON.stringify(dbRes.rows)}

Explain this in a natural, helpful way with minimal words. BE DIRECT.
                `,
                stream: false
            })
        });

        const finalData = await finalRes.json();
        
        res.json({
            reply: finalData.response || "Here are your results.",
            sql: sqlQuery //optional but very useful
        });

    } catch (err) {
        console.error("ERROR:", err.message);
        res.json({ reply: "Something went wrong. Try again." });
    }
});





app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
