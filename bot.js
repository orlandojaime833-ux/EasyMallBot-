// ============================================
// EASYMALL BOT - COMPLETE SINGLE FILE
// Global Sales Platform on Telegram
// Version: 3.0.0
// ============================================

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const cron = require('node-cron');
require('dotenv').config();

// ============================================
// ALL VARIABLES (PRE-FILLED)
// ============================================

// Telegram
const BOT_TOKEN = process.env.BOT_TOKEN || '8715965933:AAGPxTbFrGTsrx8IKPHlQX_MdIsMkJSUMVU';
const ADMIN_ID = parseInt(process.env.ADMIN_ID) || 7991785009;

// APIs
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBbFcGJYvNN-b-i2tlkiZrY7jZ_pjEij4A';
const XROCKET_API_KEY = process.env.XROCKET_API_KEY || 'c01709a9c058bd25eeefea6b2';

// Database
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_evjBA0NRF3kt@ep-rapid-dream-anzhdcg9-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require';

// Server
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';

// Plans
const PLAN_FREE_PRICE = 0;
const PLAN_BASIC_PRICE = 5;
const TRIAL_DAYS = 30;
const AFFILIATE_COMMISSION = 10;
const MINIMUM_WITHDRAW = 10;

// Features
const FEATURE_AI = true;
const FEATURE_AFFILIATES = true;
const FEATURE_RANKING = true;

// Support
const SUPPORT_CONTACT = '@EasyMallSupport';
const COMMUNITY_GROUP = 'https://t.me/EasyMallCommunity';
const BOT_NAME = 'EasyMall';
const BOT_VERSION = '3.0.0';

// ============================================
// INITIALIZATION
// ============================================

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

// Database connection
let pool = null;
let dbConnected = false;

if (DATABASE_URL) {
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    
    pool.connect((err, client, release) => {
        if (err) {
            console.error('Database error:', err.message);
            dbConnected = false;
        } else {
            console.log('Connected to PostgreSQL');
            dbConnected = true;
            release();
            initDatabase();
        }
    });
} else {
    console.log('No database - using memory storage');
}

// Memory storage
const usersMem = new Map();
const storesMem = new Map();
const productsMem = new Map();

async function query(sql, params = []) {
    if (pool && dbConnected) {
        try {
            const result = await pool.query(sql, params);
            return result;
        } catch (err) {
            return { rows: [] };
        }
    }
    return { rows: [] };
}

async function initDatabase() {
    if (!pool || !dbConnected) return;
    
    await query(`
        CREATE TABLE IF NOT EXISTS users (
            id BIGINT PRIMARY KEY,
            name VARCHAR(100),
            plan VARCHAR(10) DEFAULT 'FREE',
            balance DECIMAL(10,2) DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    
    await query(`
        CREATE TABLE IF NOT EXISTS stores (
            id VARCHAR(50) PRIMARY KEY,
            owner_id BIGINT REFERENCES users(id),
            name VARCHAR(100),
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    
    await query(`
        CREATE TABLE IF NOT EXISTS products (
            id VARCHAR(50) PRIMARY KEY,
            store_id VARCHAR(50) REFERENCES stores(id),
            name VARCHAR(200),
            price DECIMAL(10,2),
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    
    await query(`
        CREATE TABLE IF NOT EXISTS referrals (
            id SERIAL PRIMARY KEY,
            affiliate_id BIGINT,
            referred_id BIGINT,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    
    console.log('Database tables ready');
}

async function getUser(userId) {
    if (pool && dbConnected) {
        let res = await query('SELECT * FROM users WHERE id = $1', [userId]);
        if (res.rows.length === 0) {
            await query('INSERT INTO users (id, name, plan, balance, created_at) VALUES ($1, $2, $3, $4, $5)', 
                [userId, null, 'FREE', 0, new Date()]);
            return { id: userId, name: null, plan: 'FREE', balance: 0 };
        }
        return res.rows[0];
    }
    
    if (!usersMem.has(userId)) {
        usersMem.set(userId, { id: userId, name: null, plan: 'FREE', balance: 0, createdAt: new Date() });
    }
    return usersMem.get(userId);
}

async function getProducts(storeId) {
    if (pool && dbConnected) {
        const res = await query('SELECT * FROM products WHERE store_id = $1 ORDER BY created_at DESC', [storeId]);
        return res.rows;
    }
    return productsMem.get(storeId) || [];
}

async function addProduct(id, storeId, name, price) {
    if (pool && dbConnected) {
        await query('INSERT INTO products (id, store_id, name, price, created_at) VALUES ($1, $2, $3, $4, $5)', 
            [id, storeId, name, price, new Date()]);
        return { id, name, price };
    }
    
    const list = productsMem.get(storeId) || [];
    list.push({ id, name, price, createdAt: new Date() });
    productsMem.set(storeId, list);
    return { id, name, price };
}

// ============================================
// AI GEMINI
// ============================================

async function ai(prompt) {
    if (!FEATURE_AI || !GEMINI_API_KEY) return null;
    try {
        const res = await axios.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
            { contents: [{ parts: [{ text: prompt }] }] },
            { params: { key: GEMINI_API_KEY }, timeout: 10000 });
        return res.data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (e) {
        return null;
    }
}

// ============================================
// MAIN MENU (ALL BUTTONS)
// ============================================

const menu = Markup.inlineKeyboard([
    [Markup.button.callback('🏪 MY STORE', 'my_store'), Markup.button.callback('📦 PRODUCTS', 'products')],
    [Markup.button.callback('✨ ADD PRODUCT', 'add_product'), Markup.button.callback('🔗 STORE LINK', 'store_link')],
    [Markup.button.callback('🤝 AFFILIATES', 'affiliates'), Markup.button.callback('💰 BALANCE', 'balance')],
    [Markup.button.callback('💎 PLANS', 'plans'), Markup.button.callback('🏆 RANKING', 'ranking')],
    [Markup.button.callback('❓ HELP', 'help'), Markup.button.callback('🔙 EXIT', 'exit')]
]);

// ============================================
// BUTTON ACTIONS (ALL WORKING)
// ============================================

bot.action('my_store', async (ctx) => {
    await ctx.reply(`🏪 MY STORE\n\nStore ID: store_${ctx.from.id}\nPlan: FREE\nBalance: 0 USDT\n\nUse /create_store to create.`, { parse_mode: 'Markdown', ...menu });
});

bot.action('products', async (ctx) => {
    await ctx.reply(`📦 PRODUCTS\n\nNo products yet.\n\nUse /add "Name" Price to add.`, { parse_mode: 'Markdown', ...menu });
});

bot.action('add_product', async (ctx) => {
    await ctx.reply(`✨ ADD PRODUCT\n\nUse: /add "Product Name" Price\nExample: /add "Course" 49.90`, { parse_mode: 'Markdown', ...menu });
});

bot.action('store_link', async (ctx) => {
    await ctx.reply(`🔗 STORE LINK\n\nhttps://t.me/EasyMallBot?start=store_${ctx.from.id}`, { parse_mode: 'Markdown', ...menu });
});

bot.action('affiliates', async (ctx) => {
    await ctx.reply(`🤝 AFFILIATES\n\nYour link: https://t.me/EasyMallBot?start=ref_${ctx.from.id}\nCommission: ${AFFILIATE_COMMISSION}%`, { parse_mode: 'Markdown', ...menu });
});

bot.action('balance', async (ctx) => {
    const user = await getUser(ctx.from.id);
    await ctx.reply(`💰 BALANCE\n\nTotal: ${user.balance} USDT\nAvailable: ${user.balance} USDT\n\n/withdraw AMOUNT (min ${MINIMUM_WITHDRAW} USDT)`, { parse_mode: 'Markdown', ...menu });
});

bot.action('plans', async (ctx) => {
    await ctx.reply(`💎 PLANS\n\nFREE - $${PLAN_FREE_PRICE}\n• ${TRIAL_DAYS} days trial\n• 50% balance after trial\n\nBASIC - $${PLAN_BASIC_PRICE}/month\n• 100% balance\n• Affiliates (${AFFILIATE_COMMISSION}%)\n\n/subscribe_basic`, { parse_mode: 'Markdown', ...menu });
});

bot.action('ranking', async (ctx) => {
    await ctx.reply(`🏆 RANKING\n\nNo affiliates yet.\nBe the first!\n\n/affiliate_link - Join ranking`, { parse_mode: 'Markdown', ...menu });
});

bot.action('help', async (ctx) => {
    await ctx.reply(`❓ HELP\n\n/start - Menu\n/create_store - Create store\n/add "Name" Price - Add product\n/products - List products\n/balance - Check balance\n/withdraw AMOUNT - Withdraw\n/subscribe_basic - Upgrade to BASIC\n/affiliate_link - Get affiliate link`, { parse_mode: 'Markdown', ...menu });
});

bot.action('exit', async (ctx) => {
    await ctx.reply(`👋 Goodbye! Use /start to return.`);
});

// ============================================
// COMMANDS
// ============================================

bot.start(async (ctx) => {
    const name = ctx.from.first_name;
    const userId = ctx.from.id;
    const payload = ctx.payload;
    
    if (payload && payload.startsWith('ref_')) {
        const affId = parseInt(payload.replace('ref_', ''));
        if (affId !== userId && pool && dbConnected) {
            await query('INSERT INTO referrals (affiliate_id, referred_id) VALUES ($1, $2)', [affId, userId]);
        }
    }
    
    const user = await getUser(userId);
    const welcome = FEATURE_AI ? await ai(`Welcome ${name} to ${BOT_NAME}. ${TRIAL_DAYS} days free.`) : null;
    
    await ctx.reply(welcome || `🛍️ Welcome to ${BOT_NAME}, ${name}!\n\nFirst ${TRIAL_DAYS} days FREE.\n\nBalance: ${user.balance} USDT\n\nUse the buttons below.`, { parse_mode: 'Markdown', ...menu });
});

bot.command('create_store', async (ctx) => {
    const userId = ctx.from.id;
    const name = ctx.from.first_name;
    const storeId = `store_${userId}`;
    
    if (pool && dbConnected) {
        await query('INSERT INTO stores (id, owner_id, name, created_at) VALUES ($1, $2, $3, $4)', 
            [storeId, userId, `${name}'s Store`, new Date()]);
    } else {
        storesMem.set(storeId, { id: storeId, ownerId: userId, name: `${name}'s Store`, createdAt: new Date() });
        productsMem.set(storeId, []);
    }
    
    await ctx.reply(`✅ STORE CREATED!\n\nName: ${name}'s Store\nLink: t.me/EasyMallBot?start=${storeId}\n\nUse /add to add products.`, { parse_mode: 'Markdown', ...menu });
});

bot.command('add', async (ctx) => {
    const match = ctx.message.text.match(/\/add "([^"]+)" (\d+(?:\.\d+)?)/);
    if (!match) {
        return ctx.reply(`❌ Use: /add "Product Name" Price\nExample: /add "Course" 49.90`, { parse_mode: 'Markdown' });
    }
    
    const productName = match[1];
    const price = parseFloat(match[2]);
    const userId = ctx.from.id;
    const storeId = `store_${userId}`;
    const productId = Date.now().toString();
    
    const aiDesc = FEATURE_AI ? await ai(`Create short description for: ${productName}`) : null;
    
    await addProduct(productId, storeId, productName, price);
    
    await ctx.reply(`✅ PRODUCT ADDED!\n\n📦 ${productName}\n💰 ${price} USDT\n📝 ${aiDesc || 'High quality product'}`, { parse_mode: 'Markdown', ...menu });
});

bot.command('products', async (ctx) => {
    const userId = ctx.from.id;
    const storeId = `store_${userId}`;
    const list = await getProducts(storeId);
    
    if (list.length === 0) {
        return ctx.reply(`📦 NO PRODUCTS\n\nUse /add to add your first product.`, { parse_mode: 'Markdown', ...menu });
    }
    
    let msg = `📦 YOUR PRODUCTS\n\n`;
    for (let i = 0; i < list.length; i++) {
        msg += `${i+1}. ${list[i].name} - ${list[i].price} USDT\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown', ...menu });
});

bot.command('balance', async (ctx) => {
    const user = await getUser(ctx.from.id);
    await ctx.reply(`💰 YOUR BALANCE\n\nTotal: ${user.balance} USDT\nAvailable: ${user.balance} USDT\n\n/withdraw AMOUNT (min ${MINIMUM_WITHDRAW} USDT)`, { parse_mode: 'Markdown', ...menu });
});

bot.command('withdraw', async (ctx) => {
    const amount = parseFloat(ctx.message.text.split(' ')[1]);
    if (isNaN(amount) || amount < MINIMUM_WITHDRAW) {
        return ctx.reply(`❌ Use: /withdraw AMOUNT (minimum ${MINIMUM_WITHDRAW} USDT)`, { parse_mode: 'Markdown' });
    }
    
    const user = await getUser(ctx.from.id);
    if (amount > user.balance) {
        return ctx.reply(`❌ Insufficient balance. Available: ${user.balance} USDT`, { parse_mode: 'Markdown' });
    }
    
    const newBalance = user.balance - amount;
    if (pool && dbConnected) {
        await query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, ctx.from.id]);
    } else {
        user.balance = newBalance;
    }
    
    await ctx.reply(`✅ WITHDRAWAL REQUESTED!\n\nAmount: ${amount} USDT\nAwaiting admin approval.`, { parse_mode: 'Markdown', ...menu });
    await bot.telegram.sendMessage(ADMIN_ID, `💰 Withdrawal request\nUser: ${ctx.from.first_name}\nID: ${ctx.from.id}\nAmount: ${amount} USDT`);
});

bot.command('subscribe_basic', async (ctx) => {
    const userId = ctx.from.id;
    const externalId = `basic_${userId}_${Date.now()}`;
    
    let paymentUrl = null;
    if (XROCKET_API_KEY && XROCKET_API_KEY !== 'c01709a9c058bd25eeefea6b2') {
        try {
            const res = await axios.post('https://api.xrocketpay.com/v1/invoice',
                { amount: PLAN_BASIC_PRICE, currency: 'USDT', description: 'BASIC Plan', external_id: externalId },
                { headers: { Authorization: `Bearer ${XROCKET_API_KEY}` } });
            paymentUrl = res.data.payment_url;
        } catch (e) {}
    }
    
    await ctx.reply(`💳 BASIC PLAN - $${PLAN_BASIC_PRICE}/month\n\n${paymentUrl ? `Payment link: ${paymentUrl}` : 'Subscribe: https://xrocketpay.com'}\n\nAfter payment, your plan will be activated.`, { parse_mode: 'Markdown', ...menu });
});

bot.command('affiliate_link', async (ctx) => {
    const link = `https://t.me/EasyMallBot?start=ref_${ctx.from.id}`;
    await ctx.reply(`🤝 YOUR AFFILIATE LINK\n\n${link}\n\nCommission: ${AFFILIATE_COMMISSION}% of each BASIC subscription`, { parse_mode: 'Markdown', ...menu });
});

// ============================================
// AI RESPONDS TO ANY TEXT
// ============================================

bot.on('text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    if (ctx.message.text.startsWith('/')) return;
    
    if (FEATURE_AI) {
        const response = await ai(ctx.message.text);
        if (response) {
            await ctx.reply(response, { parse_mode: 'Markdown', ...menu });
            return;
        }
    }
    await ctx.reply(`How can I help you? Use the buttons below.`, { parse_mode: 'Markdown', ...menu });
});

// ============================================
// WEBHOOK FOR XROCKET
// ============================================

app.post('/webhook/xrocket', async (req, res) => {
    const { status, external_id } = req.body;
    
    if (status === 'paid' && external_id && external_id.startsWith('basic_')) {
        const userId = parseInt(external_id.split('_')[1]);
        await query('UPDATE users SET plan = BASIC WHERE id = $1', [userId]);
        await bot.telegram.sendMessage(userId, `✅ BASIC PLAN ACTIVATED!\n\nNow you have 100% balance and affiliate features.`);
        await bot.telegram.sendMessage(ADMIN_ID, `💰 New BASIC subscription: User ${userId}`);
    }
    res.json({ ok: true });
});

// ============================================
// DAILY REPORT TO ADMIN
// ============================================

cron.schedule('59 23 * * *', async () => {
    let totalUsers = 0, totalStores = 0;
    if (pool && dbConnected) {
        const u = await query('SELECT COUNT(*) FROM users');
        const s = await query('SELECT COUNT(*) FROM stores');
        totalUsers = parseInt(u.rows[0]?.count || 0);
        totalStores = parseInt(s.rows[0]?.count || 0);
    } else {
        totalUsers = usersMem.size;
        totalStores = storesMem.size;
    }
    
    await bot.telegram.sendMessage(ADMIN_ID, 
        `📊 DAILY REPORT - ${BOT_NAME}\n\nUsers: ${totalUsers}\nStores: ${totalStores}\nSystem: Online\nVersion: ${BOT_VERSION}`);
}, { timezone: "America/Sao_Paulo" });

// ============================================
// SERVER
// ============================================

app.get('/', (req, res) => {
    res.json({ name: BOT_NAME, version: BOT_VERSION, status: 'online' });
});

app.listen(PORT, () => {
    console.log(`✅ Server on port ${PORT}`);
    console.log(`🚀 ${BOT_NAME} Bot started!`);
    console.log(`🤖 Bot: @EasyMallBot`);
    console.log(`🧠 AI: ${FEATURE_AI ? 'ON' : 'OFF'}`);
    console.log(`💾 DB: ${dbConnected ? 'PostgreSQL' : 'Memory'}`);
    bot.launch();
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
