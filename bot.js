// ============================================
// EASYMALL BOT - COM SESSÃO DO TELEGRAM
// Sem conflito de variáveis globais
// ============================================

const { Telegraf, Markup } = require('telegraf');
const { LocalSession } = require('telegraf-session-local');
const express = require('express');
const { Pool } = require('pg');
const cron = require('node-cron');
require('dotenv').config();

// ============================================
// CONFIGURAÇÕES
// ============================================

const BOT_TOKEN = process.env.BOT_TOKEN || '8715965933:AAGPxTbFrGTsrx8IKPHlQX_MdIsMkJSUMVU';
const ADMIN_ID = parseInt(process.env.ADMIN_ID) || 7991785009;
const DATABASE_URL = process.env.DATABASE_URL;
const PORT = process.env.PORT || 3000;

// Sessão local (cada usuário tem sua própria sessão)
const session = new LocalSession({ database: 'sessions.json' });

// ============================================
// INICIALIZAÇÃO DO BOT
// ============================================

const bot = new Telegraf(BOT_TOKEN);
bot.use(session.middleware());

// Inicializar sessão para novos usuários
bot.use((ctx, next) => {
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.page) ctx.session.page = 1;
    if (!ctx.session.cart) ctx.session.cart = [];
    if (!ctx.session.temp) ctx.session.temp = {};
    return next();
});

const app = express();
app.use(express.json());

// ============================================
// BANCO DE DADOS (Neon PostgreSQL)
// ============================================

let pool = null;
let dbConnected = false;

if (DATABASE_URL) {
    pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    pool.connect((err) => {
        if (err) { console.error('Database error:', err.message); dbConnected = false; }
        else { console.log('Connected to PostgreSQL'); dbConnected = true; initDatabase(); }
    });
} else { console.log('DATABASE_URL not configured - using memory'); }

// Memória fallback (cada usuário isolado)
const usersMem = new Map();
const storesMem = new Map();
const productsMem = new Map();

async function query(sql, params = []) {
    if (pool && dbConnected) {
        try { return await pool.query(sql, params); }
        catch (err) { return { rows: [] }; }
    }
    return { rows: [] };
}

async function initDatabase() {
    if (!pool || !dbConnected) return;
    await query(`CREATE TABLE IF NOT EXISTS users (
        id BIGINT PRIMARY KEY, name VARCHAR(100), type VARCHAR(20) DEFAULT 'cliente',
        plan VARCHAR(20) DEFAULT 'TESTE', plan_expires TIMESTAMP, balance DECIMAL(10,2) DEFAULT 0,
        total_earned DECIMAL(10,2) DEFAULT 0, referred_by BIGINT, store_id VARCHAR(50), created_at TIMESTAMP DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS stores (
        id VARCHAR(50) PRIMARY KEY, owner_id BIGINT REFERENCES users(id), name VARCHAR(100),
        template VARCHAR(50) DEFAULT 'moderno', created_at TIMESTAMP DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(50) PRIMARY KEY, store_id VARCHAR(50) REFERENCES stores(id),
        name VARCHAR(200), price DECIMAL(10,2), description TEXT, image TEXT, link TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY, affiliate_id BIGINT, referred_id BIGINT, commission DECIMAL(10,2), paid BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log('Database tables ready');
}

async function getUser(userId) {
    if (pool && dbConnected) {
        let res = await query('SELECT * FROM users WHERE id = $1', [userId]);
        if (res.rows.length === 0) {
            await query('INSERT INTO users (id, name, type, plan, plan_expires, balance, total_earned, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [userId, null, 'cliente', 'TESTE', new Date(Date.now() + 30*24*60*60*1000), 0, 0, new Date()]);
            return { id: userId, name: null, type: 'cliente', plan: 'TESTE', balance: 0, total_earned: 0, store_id: null };
        }
        return res.rows[0];
    }
    if (!usersMem.has(userId)) {
        usersMem.set(userId, { id: userId, name: null, type: 'cliente', plan: 'TESTE', balance: 0, totalEarned: 0, storeId: null, createdAt: new Date() });
    }
    return usersMem.get(userId);
}

// ============================================
// MENUS COM SESSÃO (sem variável global)
// ============================================

function getMenu(page) {
    if (page === 1) return Markup.inlineKeyboard([
        [Markup.button.callback('🏪 MINHA LOJA', 'my_store'), Markup.button.callback('📦 PRODUTOS', 'products')],
        [Markup.button.callback('✨ ADICIONAR', 'add_product'), Markup.button.callback('🔗 LINK', 'store_link')],
        [Markup.button.callback('◀️', 'nav_prev'), Markup.button.callback('▶️', 'nav_next')]
    ]);
    if (page === 2) return Markup.inlineKeyboard([
        [Markup.button.callback('🤝 AFILIADOS', 'affiliates'), Markup.button.callback('💰 SALDO', 'balance')],
        [Markup.button.callback('💎 PLANOS', 'plans'), Markup.button.callback('🏆 RANKING', 'ranking')],
        [Markup.button.callback('◀️', 'nav_prev'), Markup.button.callback('▶️', 'nav_next')]
    ]);
    return Markup.inlineKeyboard([
        [Markup.button.callback('❓ AJUDA', 'help'), Markup.button.callback('⚙️ CONFIG', 'config')],
        [Markup.button.callback('📊 ESTATÍSTICAS', 'stats'), Markup.button.callback('🔔 NOTIFICAÇÕES', 'notifications')],
        [Markup.button.callback('◀️', 'nav_prev'), Markup.button.callback('🔙 SAIR', 'exit')]
    ]);
}

// Navegação usando ctx.session (sem variável global)
bot.action('nav_next', async (ctx) => {
    ctx.session.page = ctx.session.page < 3 ? ctx.session.page + 1 : 1;
    await ctx.editMessageReplyMarkup({ reply_markup: getMenu(ctx.session.page).reply_markup });
});
bot.action('nav_prev', async (ctx) => {
    ctx.session.page = ctx.session.page > 1 ? ctx.session.page - 1 : 3;
    await ctx.editMessageReplyMarkup({ reply_markup: getMenu(ctx.session.page).reply_markup });
});

// ============================================
// COMANDOS PRINCIPAIS
// ============================================

bot.start(async (ctx) => {
    ctx.session.page = 1;
    const userId = ctx.from.id;
    const name = ctx.from.first_name;
    const payload = ctx.payload;
    const user = await getUser(userId);
    
    if (payload && payload.startsWith('ref_')) {
        const affId = parseInt(payload.replace('ref_', ''));
        if (affId !== userId && user.referred_by === null) {
            await query('UPDATE users SET referred_by = $1 WHERE id = $2', [affId, userId]);
            const commission = user.plan === 'BASICO' ? 0.2 : 0.5;
            await query('INSERT INTO referrals (affiliate_id, referred_id, commission) VALUES ($1, $2, $3)', [affId, userId, commission]);
            await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [commission, affId]);
            await bot.telegram.sendMessage(affId, `💰 Comissão de ${commission} TON recebida por indicação!`);
        }
    }
    
    const planInfo = { templates: 3, features: 5, commission: 10 };
    const isTrial = user.plan === 'TESTE' && new Date(user.plan_expires) > new Date();
    
    let msg = `🌟 *EASYMALL 2050X*\n\n👤 Olá, ${name}!\n💰 Saldo: ${user.balance} TON\n📊 Plano: ${user.plan}`;
    if (isTrial) msg += ` (teste grátis - ${Math.ceil((new Date(user.plan_expires) - new Date()) / (1000*60*60*24))} dias)`;
    msg += `\n🎨 Templates: ${planInfo.templates}\n⚡ Recursos: ${planInfo.features}\n💸 Comissão: ${planInfo.commission}%`;
    
    await ctx.reply(msg, { parse_mode: 'Markdown', ...getMenu(ctx.session.page) });
});

bot.command('create_store', async (ctx) => {
    const userId = ctx.from.id;
    const user = await getUser(userId);
    if (user.store_id) return ctx.reply('❌ Você já tem uma loja!');
    
    const storeId = `store_${userId}_${Date.now()}`;
    await query('INSERT INTO stores (id, owner_id, name) VALUES ($1, $2, $3)', [storeId, userId, `Loja de ${user.name || userId}`]);
    await query('UPDATE users SET store_id = $1 WHERE id = $2', [storeId, userId]);
    
    await ctx.reply(`✅ LOJA CRIADA!\n🔗 Link: t.me/EasyMallBot?start=${storeId}\n📌 Use /add para adicionar produtos.`, { parse_mode: 'Markdown', ...getMenu(ctx.session.page) });
});

bot.command('add', async (ctx) => {
    const userId = ctx.from.id;
    const user = await getUser(userId);
    if (!user.store_id) return ctx.reply('❌ Crie uma loja primeiro: /create_store');
    
    const match = ctx.message.text.match(/\/add "([^"]+)" (\d+(?:\.\d+)?)/);
    if (!match) return ctx.reply(`❌ Use: /add "Nome" Preço\nEx: /add "Curso JS" 49.90`);
    
    const productId = `prod_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    await query('INSERT INTO products (id, store_id, name, price) VALUES ($1, $2, $3, $4)', [productId, user.store_id, match[1], parseFloat(match[2])]);
    
    await ctx.reply(`✅ PRODUTO ADICIONADO!\n📦 ${match[1]} - ${match[2]} TON\n🆔 ID: ${productId}\n🔗 Link: t.me/EasyMallBot?start=buy_${productId}`, { parse_mode: 'Markdown', ...getMenu(ctx.session.page) });
});

bot.command('products', async (ctx) => {
    const userId = ctx.from.id;
    const user = await getUser(userId);
    if (!user.store_id) return ctx.reply('❌ Nenhuma loja encontrada.');
    
    const products = await query('SELECT * FROM products WHERE store_id = $1', [user.store_id]);
    if (products.rows.length === 0) return ctx.reply('📦 Nenhum produto. Use /add');
    
    let msg = `📦 *SEUS PRODUTOS*\n\n`;
    for (let i = 0; i < products.rows.length; i++) {
        const p = products.rows[i];
        msg += `${i+1}. *${p.name}* - ${p.price} TON\n🆔 \`${p.id}\`\n\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown', ...getMenu(ctx.session.page) });
});

bot.command('balance', async (ctx) => {
    const user = await getUser(ctx.from.id);
    await ctx.reply(`💰 *SALDO*\n\nTotal: ${user.balance} TON\nMínimo saque: 0.3 TON\n\n/withdraw VALOR`, { parse_mode: 'Markdown', ...getMenu(ctx.session.page) });
});

bot.command('withdraw', async (ctx) => {
    const amount = parseFloat(ctx.message.text.split(' ')[1]);
    if (isNaN(amount) || amount < 0.3) return ctx.reply(`❌ Mínimo: 0.3 TON`);
    const user = await getUser(ctx.from.id);
    if (amount > user.balance) return ctx.reply(`❌ Saldo insuficiente. Disponível: ${user.balance} TON`);
    
    await query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, ctx.from.id]);
    await ctx.reply(`✅ SAQUE SOLICITADO!\n💰 ${amount} TON\n⏳ Aguarde aprovação (até 24h)`, { parse_mode: 'Markdown', ...getMenu(ctx.session.page) });
    await bot.telegram.sendMessage(ADMIN_ID, `💰 SAQUE: ${ctx.from.first_name} pediu ${amount} TON`);
});

bot.command('invite', async (ctx) => {
    const user = await getUser(ctx.from.id);
    if (user.type === 'cliente') return ctx.reply('❌ Seja comerciante ou afiliado para indicar.');
    const link = `https://t.me/EasyMallBot?start=ref_${ctx.from.id}`;
    await ctx.reply(`🔗 *SEU LINK DE INDICAÇÃO*\n\n${link}\n💰 Comissão: 10% da primeira ativação`, { parse_mode: 'Markdown', ...getMenu(ctx.session.page) });
});

bot.command('plans', async (ctx) => {
    await ctx.reply(
        `💎 *PLANOS EASYMALL*\n\n` +
        `🎁 TESTE (30 dias): $0 - 3 templates, 5 recursos, 10% comissão\n` +
        `📀 BÁSICO: 2 TON/mês - 8 templates, 8 recursos\n` +
        `👑 AVANÇADO: 5 TON/mês - 15 templates, 15 recursos\n\n` +
        `/subscribe_basic - Assinar BÁSICO\n/subscribe_advanced - Assinar AVANÇADO`,
        { parse_mode: 'Markdown', ...getMenu(ctx.session.page) });
});

bot.command('subscribe_basic', async (ctx) => {
    await ctx.reply(`💳 Plano BÁSICO - 2 TON/mês\n💰 Envie 2 TON para: TON_WALLET_ADDRESS\n\n✅ Após pagamento, envie /confirm_basic`, { parse_mode: 'Markdown' });
});
bot.command('subscribe_advanced', async (ctx) => {
    await ctx.reply(`💳 Plano AVANÇADO - 5 TON/mês\n💰 Envie 5 TON para: TON_WALLET_ADDRESS\n\n✅ Após pagamento, envie /confirm_advanced`, { parse_mode: 'Markdown' });
});

bot.command('ranking', async (ctx) => {
    const top = await query('SELECT id, name, total_earned FROM users ORDER BY total_earned DESC LIMIT 10');
    let msg = `🏆 *RANKING GLOBAL*\n\n`;
    for (let i = 0; i < top.rows.length; i++) {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '📌';
        msg += `${medal} ${top.rows[i].name || top.rows[i].id} - ${top.rows[i].total_earned} TON\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown', ...getMenu(ctx.session.page) });
});

// ============================================
// AÇÕES DOS BOTÕES
// ============================================

bot.action('my_store', async (ctx) => {
    const user = await getUser(ctx.from.id);
    if (!user.store_id) return ctx.reply('❌ Crie uma loja: /create_store');
    await ctx.reply(`🏪 *SUA LOJA*\n\nID: ${user.store_id}\n🔗 Link: t.me/EasyMallBot?start=${user.store_id}`, { parse_mode: 'Markdown', ...getMenu(ctx.session.page) });
});
bot.action('products', async (ctx) => { await ctx.reply('/products'); });
bot.action('add_product', async (ctx) => { await ctx.reply(`✨ /add "Nome" Preço\nEx: /add "Curso JS" 49.90`); });
bot.action('store_link', async (ctx) => {
    const user = await getUser(ctx.from.id);
    if (!user.store_id) return ctx.reply('❌ Crie uma loja primeiro');
    await ctx.reply(`🔗 t.me/EasyMallBot?start=${user.store_id}`, { parse_mode: 'Markdown' });
});
bot.action('affiliates', async (ctx) => { await ctx.reply('/invite'); });
bot.action('balance', async (ctx) => { await ctx.reply('/balance'); });
bot.action('plans', async (ctx) => { await ctx.reply('/plans'); });
bot.action('ranking', async (ctx) => { await ctx.reply('/ranking'); });
bot.action('help', async (ctx) => {
    await ctx.reply(`❓ *AJUDA*\n\n/start - Menu\n/create_store - Criar loja\n/add - Adicionar produto\n/products - Listar produtos\n/balance - Ver saldo\n/withdraw - Sacar\n/invite - Link de indicação\n/plans - Ver planos`, { parse_mode: 'Markdown', ...getMenu(ctx.session.page) });
});
bot.action('exit', async (ctx) => { await ctx.reply(`👋 Até logo! Use /start para voltar.`); });
bot.action('config', async (ctx) => { await ctx.reply(`⚙️ CONFIGURAÇÕES\n/template - Mudar template\n/config name "Nome" - Mudar nome`, { parse_mode: 'Markdown' }); });
bot.action('stats', async (ctx) => { await ctx.reply(`📊 ESTATÍSTICAS\nUse /products e /balance`, { parse_mode: 'Markdown' }); });
bot.action('notifications', async (ctx) => { await ctx.reply(`🔔 NOTIFICAÇÕES\nAtivadas por padrão.`, { parse_mode: 'Markdown' }); });

// ============================================
// SERVIDOR
// ============================================

app.get('/', (req, res) => { res.json({ name: 'EasyMall Bot', status: 'online' }); });
app.listen(PORT, () => {
    console.log(`✅ Server on port ${PORT}`);
    console.log(`🚀 EasyMall Bot started`);
    bot.launch();
});
