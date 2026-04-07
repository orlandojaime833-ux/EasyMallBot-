// ============================================
// EASYMALL BOT - PLATAFORMA DE VENDAS GLOBAL
// Versao: 3.0.0
// Funcionalidades: Loja, Produtos, Afiliados, IA Gemini, Planos
// ============================================

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const cron = require('node-cron');
require('dotenv').config();

// ============================================
// CONFIGURACOES
// ============================================

const BOT_TOKEN = process.env.BOT_TOKEN || '8715965933:AAGPxTbFrGTsrx8IKPHlQX_MdIsMkJSUMVU';
const ADMIN_ID = parseInt(process.env.ADMIN_ID) || 7991785009;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBbFcGJYvNN-b-i2tlkiZrY7jZ_pjEij4A';
const XROCKET_API_KEY = process.env.XROCKET_API_KEY || 'c01709a9c058bd25eeefea6b2';
const DATABASE_URL = process.env.DATABASE_URL;
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

// ============================================
// BANCO DE DADOS (NEON POSTGRESQL)
// ============================================

let pool = null;
let dbConnected = false;

if (DATABASE_URL) {
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    
    pool.connect((err, client, release) => {
        if (err) {
            console.error('Erro ao conectar ao Neon:', err.message);
            dbConnected = false;
        } else {
            console.log('Conectado ao Neon PostgreSQL');
            dbConnected = true;
            release();
            initDatabase();
            initAfiliadosTables();
        }
    });
} else {
    console.log('DATABASE_URL nao configurado - usando memoria');
}

// Fallback em memoria
const usuariosMemoria = new Map();
const lojasMemoria = new Map();
const produtosMemoria = new Map();
const vendasMemoria = new Map();
const referralsMemoria = new Map();
const comissoesMemoria = new Map();

async function query(sql, params = []) {
    if (pool && dbConnected) {
        try {
            const result = await pool.query(sql, params);
            return result;
        } catch (err) {
            console.error('Erro na query:', err.message);
            return { rows: [] };
        }
    }
    return { rows: [] };
}

// ============================================
// FUNCOES DO BANCO
// ============================================

async function initDatabase() {
    if (!pool || !dbConnected) return;
    
    await query(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id BIGINT PRIMARY KEY,
            nome VARCHAR(100),
            tipo VARCHAR(20) DEFAULT 'cliente',
            plano VARCHAR(10) DEFAULT 'FREE',
            plano_ativo BOOLEAN DEFAULT true,
            saldo_total DECIMAL(10,2) DEFAULT 0,
            saldo_disponivel DECIMAL(10,2) DEFAULT 0,
            vendas INTEGER DEFAULT 0,
            nivel INTEGER DEFAULT 1,
            data_criacao TIMESTAMP DEFAULT NOW()
        )
    `);
    
    await query(`
        CREATE TABLE IF NOT EXISTS lojas (
            id VARCHAR(50) PRIMARY KEY,
            dono_id BIGINT REFERENCES usuarios(id),
            nome VARCHAR(100),
            criada TIMESTAMP DEFAULT NOW()
        )
    `);
    
    await query(`
        CREATE TABLE IF NOT EXISTS produtos (
            id VARCHAR(50) PRIMARY KEY,
            loja_id VARCHAR(50) REFERENCES lojas(id),
            nome VARCHAR(200),
            preco DECIMAL(10,2),
            data_criacao TIMESTAMP DEFAULT NOW()
        )
    `);
    
    await query(`
        CREATE TABLE IF NOT EXISTS vendas (
            id SERIAL PRIMARY KEY,
            produto_id VARCHAR(50),
            comerciante_id BIGINT,
            valor DECIMAL(10,2),
            data_criacao TIMESTAMP DEFAULT NOW()
        )
    `);
    
    console.log('Tabelas principais criadas');
}

async function initAfiliadosTables() {
    if (!pool || !dbConnected) return;
    
    await query(`
        CREATE TABLE IF NOT EXISTS referrals (
            id SERIAL PRIMARY KEY,
            afiliado_id BIGINT REFERENCES usuarios(id),
            indicado_id BIGINT REFERENCES usuarios(id),
            status VARCHAR(20) DEFAULT 'ativo',
            data_indicacao TIMESTAMP DEFAULT NOW()
        )
    `);
    
    await query(`
        CREATE TABLE IF NOT EXISTS comissoes (
            id SERIAL PRIMARY KEY,
            afiliado_id BIGINT REFERENCES usuarios(id),
            valor DECIMAL(10,2),
            tipo VARCHAR(20) DEFAULT 'assinatura',
            status VARCHAR(20) DEFAULT 'pendente',
            data_comissao TIMESTAMP DEFAULT NOW()
        )
    `);
    
    console.log('Tabelas de afiliados criadas');
}

async function getUsuario(userId) {
    if (pool && dbConnected) {
        const result = await query('SELECT * FROM usuarios WHERE id = $1', [userId]);
        if (result.rows.length === 0) {
            await query(
                `INSERT INTO usuarios (id, nome, tipo, plano, plano_ativo, saldo_total, saldo_disponivel, vendas, nivel, data_criacao) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [userId, null, 'cliente', 'FREE', true, 0, 0, 0, 1, new Date()]
            );
            return { id: userId, nome: null, tipo: 'cliente', plano: 'FREE', plano_ativo: true, saldo_total: 0, saldo_disponivel: 0, vendas: 0, nivel: 1 };
        }
        return result.rows[0];
    }
    
    if (!usuariosMemoria.has(userId)) {
        usuariosMemoria.set(userId, {
            id: userId,
            nome: null,
            tipo: 'cliente',
            plano: 'FREE',
            planoAtivo: true,
            saldoTotal: 0,
            saldoDisponivel: 0,
            vendas: 0,
            nivel: 1,
            dataCriacao: new Date()
        });
    }
    return usuariosMemoria.get(userId);
}

async function getProdutos(lojaId) {
    if (pool && dbConnected) {
        const result = await query('SELECT * FROM produtos WHERE loja_id = $1 ORDER BY data_criacao DESC', [lojaId]);
        return result.rows;
    }
    return produtosMemoria.get(lojaId) || [];
}

async function addProduto(id, lojaId, nome, preco) {
    if (pool && dbConnected) {
        await query(
            `INSERT INTO produtos (id, loja_id, nome, preco, data_criacao) VALUES ($1, $2, $3, $4, $5)`,
            [id, lojaId, nome, preco, new Date()]
        );
        return { id, nome, preco };
    }
    
    const produtosLoja = produtosMemoria.get(lojaId) || [];
    const novoProduto = { id, nome, preco, dataCriacao: new Date() };
    produtosLoja.push(novoProduto);
    produtosMemoria.set(lojaId, produtosLoja);
    return novoProduto;
}

// ============================================
// SISTEMA DE AFILIADOS
// ============================================

function gerarLinkAfiliado(userId) {
    return `https://t.me/EasyMallBot?start=ref_${userId}`;
}

async function processarIndicacao(indicadoId, afiliadoId) {
    if (!pool || !dbConnected) return true;
    
    const existing = await query('SELECT * FROM referrals WHERE indicado_id = $1', [indicadoId]);
    if (existing.rows.length > 0) return false;
    
    await query(
        `INSERT INTO referrals (afiliado_id, indicado_id, data_indicacao) VALUES ($1, $2, NOW())`,
        [afiliadoId, indicadoId]
    );
    return true;
}

async function registrarComissao(indicadoId, valor) {
    if (!pool || !dbConnected) return;
    
    const referral = await query('SELECT afiliado_id FROM referrals WHERE indicado_id = $1 AND status = ativo', [indicadoId]);
    if (referral.rows.length === 0) return;
    
    const afiliadoId = referral.rows[0].afiliado_id;
    const comissao = valor * 0.10;
    
    await query(
        `INSERT INTO comissoes (afiliado_id, valor, tipo, status, data_comissao) VALUES ($1, $2, 'assinatura', 'pendente', NOW())`,
        [afiliadoId, comissao]
    );
    
    await query(`UPDATE usuarios SET saldo_disponivel = saldo_disponivel + $1 WHERE id = $2`, [comissao, afiliadoId]);
    
    await bot.telegram.sendMessage(afiliadoId,
        `Nova comissao!\n\nUm amigo assinou o plano BASIC.\nVoce ganhou ${comissao} USDT (10%)`,
        { parse_mode: 'Markdown' }
    );
}

// ============================================
// IA GEMINI
// ============================================

async function callGemini(prompt) {
    if (!GEMINI_API_KEY) return null;
    
    try {
        const response = await axios.post(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
            {
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.8,
                    maxOutputTokens: 500,
                    topP: 0.95
                }
            },
            {
                params: { key: GEMINI_API_KEY },
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000
            }
        );
        return response.data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (error) {
        console.error('Erro IA:', error.message);
        return null;
    }
}

async function easyMallResponder(mensagem, nomeUsuario, idioma = 'pt') {
    const prompt = `
Voce e o EasyMall, plataforma de vendas no Telegram.

Usuario: ${nomeUsuario}
Idioma: ${idioma}
Mensagem: "${mensagem}"

Responda de forma acolhedora e pratica no idioma ${idioma}.

Resposta:`;
    return await callGemini(prompt);
}

// ============================================
// PAGAMENTOS XROCKET
// ============================================

async function criarPagamentoXrocket(valor, descricao, externalId) {
    if (!XROCKET_API_KEY) return null;
    
    try {
        const response = await axios.post(
            'https://api.xrocketpay.com/v1/invoice',
            {
                amount: valor,
                currency: 'USDT',
                description: descricao,
                external_id: externalId,
                expires_in: 3600
            },
            {
                headers: { 'Authorization': `Bearer ${XROCKET_API_KEY}` }
            }
        );
        return response.data.payment_url;
    } catch (error) {
        console.error('Erro xRocket:', error.message);
        return null;
    }
}

// ============================================
// MENU PRINCIPAL
// ============================================

const mainMenu = Markup.inlineKeyboard([
    [Markup.button.callback('My Store', 'minha_loja'), Markup.button.callback('Products', 'produtos')],
    [Markup.button.callback('Add Product', 'adicionar'), Markup.button.callback('Store Link', 'link_loja')],
    [Markup.button.callback('Affiliates', 'afiliados'), Markup.button.callback('Balance', 'saldo')],
    [Markup.button.callback('Plans', 'planos'), Markup.button.callback('Ranking', 'ranking')],
    [Markup.button.callback('Help', 'ajuda'), Markup.button.callback('Exit', 'sair')]
]);

// ============================================
// COMANDOS
// ============================================

bot.start(async (ctx) => {
    const nome = ctx.from.first_name;
    const payload = ctx.payload;
    const userId = ctx.from.id;
    
    if (payload && payload.startsWith('ref_')) {
        const afiliadoId = parseInt(payload.replace('ref_', ''));
        if (afiliadoId !== userId) {
            await processarIndicacao(userId, afiliadoId);
            await ctx.reply(`Welcome! You were invited by a friend.\n\nUse /create_store to start.`);
            return;
        }
    }
    
    const usuario = await getUsuario(userId);
    const diasRestantes = 30;
    
    await ctx.reply(
        `Welcome to EasyMall, ${nome}!\n\n` +
        `First month FREE with FULL features!\n` +
        `${diasRestantes} days remaining\n\n` +
        `Balance: ${usuario.saldo_disponivel} USDT\n` +
        `Plan: ${usuario.plano}\n\n` +
        `Use the buttons below:`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

bot.command('create_store', async (ctx) => {
    const userId = ctx.from.id;
    const nome = ctx.from.first_name;
    const lojaId = `store_${userId}`;
    
    if (pool && dbConnected) {
        await query(`INSERT INTO lojas (id, dono_id, nome, criada) VALUES ($1, $2, $3, $4)`, [lojaId, userId, `${nome}'s Store`, new Date()]);
    } else {
        lojasMemoria.set(lojaId, { id: lojaId, donoId: userId, nome: `${nome}'s Store`, criada: new Date() });
        produtosMemoria.set(lojaId, []);
    }
    
    await ctx.reply(
        `Store created!\n\n` +
        `Store link: t.me/EasyMallBot?start=${lojaId}\n\n` +
        `Add products: /add "Product Name" Price`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

bot.command('add', async (ctx) => {
    const userId = ctx.from.id;
    const match = ctx.message.text.match(/\/add "([^"]+)" (\d+(?:\.\d+)?)/);
    
    if (!match) {
        return ctx.reply(`Use: /add "Product Name" Price\nExample: /add "JavaScript Course" 49.90`, { parse_mode: 'Markdown' });
    }
    
    const productName = match[1];
    const price = parseFloat(match[2]);
    const lojaId = `store_${userId}`;
    const productId = Date.now().toString();
    
    await addProduto(productId, lojaId, productName, price);
    
    await ctx.reply(
        `Product added!\n\n` +
        `Name: ${productName}\n` +
        `Price: ${price} USDT\n` +
        `ID: ${productId}`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

bot.command('products', async (ctx) => {
    const userId = ctx.from.id;
    const lojaId = `store_${userId}`;
    const produtosLista = await getProdutos(lojaId);
    
    if (produtosLista.length === 0) {
        return ctx.reply(`No products yet.\n\nUse /add to add your first product.`, { parse_mode: 'Markdown', ...mainMenu });
    }
    
    let msg = `Your products:\n\n`;
    for (let i = 0; i < produtosLista.length; i++) {
        const p = produtosLista[i];
        msg += `${i+1}. ${p.name || p.nome} - ${p.price || p.preco} USDT\n`;
        msg += `   ID: ${p.id}\n\n`;
    }
    
    await ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenu });
});

bot.command('balance', async (ctx) => {
    const userId = ctx.from.id;
    const usuario = await getUsuario(userId);
    
    await ctx.reply(
        `Your balance:\n\n` +
        `Total: ${usuario.saldo_total || 0} USDT\n` +
        `Available: ${usuario.saldo_disponivel || 0} USDT\n\n` +
        `/withdraw AMOUNT - Withdraw balance`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

bot.command('withdraw', async (ctx) => {
    const userId = ctx.from.id;
    const valor = parseFloat(ctx.message.text.split(' ')[1]);
    const usuario = await getUsuario(userId);
    
    if (isNaN(valor) || valor < 10) {
        return ctx.reply(`Use: /withdraw AMOUNT (minimum 10 USDT)`, { parse_mode: 'Markdown' });
    }
    
    if (valor > (usuario.saldo_disponivel || 0)) {
        return ctx.reply(`Insufficient balance. Available: ${usuario.saldo_disponivel || 0} USDT`, { parse_mode: 'Markdown' });
    }
    
    const novoSaldo = (usuario.saldo_disponivel || 0) - valor;
    if (pool && dbConnected) {
        await query(`UPDATE usuarios SET saldo_disponivel = $1 WHERE id = $2`, [novoSaldo, userId]);
    } else {
        usuario.saldo_disponivel = novoSaldo;
    }
    
    await ctx.reply(
        `Withdrawal requested!\n\n` +
        `Amount: ${valor.toFixed(2)} USDT\n` +
        `Date: ${new Date().toLocaleString()}\n\n` +
        `Awaiting admin approval.`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
    
    await bot.telegram.sendMessage(ADMIN_ID,
        `Withdrawal requested\n` +
        `User: ${ctx.from.first_name}\n` +
        `ID: ${userId}\n` +
        `Amount: ${valor.toFixed(2)} USDT`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('subscribe_basic', async (ctx) => {
    const userId = ctx.from.id;
    const externalId = `basic_${userId}_${Date.now()}`;
    
    const paymentUrl = await criarPagamentoXrocket(5, `BASIC Plan - EasyMall`, externalId);
    
    if (!paymentUrl) {
        return ctx.reply(`Error generating payment. Please try again.`, { parse_mode: 'Markdown' });
    }
    
    await ctx.reply(
        `BASIC Plan - $5/month\n\n` +
        `Payment link:\n${paymentUrl}\n\n` +
        `After payment, your plan will be activated automatically.`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

bot.command('affiliate_link', async (ctx) => {
    const userId = ctx.from.id;
    const link = gerarLinkAfiliado(userId);
    
    await ctx.reply(
        `Your affiliate link:\n\n${link}\n\n` +
        `Commission: 10% of each BASIC subscription\n` +
        `Share this link with friends!`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

bot.command('my_commissions', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!pool || !dbConnected) {
        return ctx.reply(`Commissions: 0 USDT\n\n/affiliate_link - Start earning`, { parse_mode: 'Markdown' });
    }
    
    const comissoes = await query(`SELECT * FROM comissoes WHERE afiliado_id = $1 ORDER BY data_comissao DESC`, [userId]);
    const total = comissoes.rows.reduce((sum, c) => sum + c.valor, 0);
    
    let msg = `Your commissions:\n\nTotal: ${total.toFixed(2)} USDT\n\n`;
    for (const c of comissoes.rows.slice(0, 5)) {
        msg += `${c.valor} USDT - ${new Date(c.data_comissao).toLocaleDateString()}\n`;
    }
    msg += `\n/affiliate_link - Get your link`;
    
    await ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenu });
});

bot.command('ranking', async (ctx) => {
    if (!pool || !dbConnected) {
        return ctx.reply(`Ranking not available yet.\n\nBe the first to appear here!`, { parse_mode: 'Markdown' });
    }
    
    const ranking = await query(`
        SELECT u.id, u.nome, COALESCE(SUM(c.valor), 0) as total
        FROM usuarios u
        LEFT JOIN comissoes c ON u.id = c.afiliado_id AND c.data_comissao >= date_trunc('month', NOW())
        GROUP BY u.id, u.nome
        ORDER BY total DESC
        LIMIT 10
    `);
    
    let msg = `Global Ranking - Top Affiliates\n\n`;
    for (let i = 0; i < ranking.rows.length; i++) {
        const r = ranking.rows[i];
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '📌';
        msg += `${medal} ${r.nome || r.id} - ${parseFloat(r.total).toFixed(2)} USDT\n`;
    }
    
    if (ranking.rows.length === 0) msg += `No affiliates yet.\n`;
    msg += `\n/affiliate_link - Join the ranking!`;
    
    await ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenu });
});

// ============================================
// ACOES DOS BOTOES
// ============================================

bot.action('minha_loja', async (ctx) => {
    await bot.telegram.sendMessage(ctx.chat.id, '/create_store');
});

bot.action('produtos', async (ctx) => {
    await bot.telegram.sendMessage(ctx.chat.id, '/products');
});

bot.action('adicionar', async (ctx) => {
    await ctx.reply(`Add product: /add "Product Name" Price\nExample: /add "JavaScript Course" 49.90`, { parse_mode: 'Markdown', ...mainMenu });
});

bot.action('link_loja', async (ctx) => {
    const userId = ctx.from.id;
    const link = `https://t.me/EasyMallBot?start=store_${userId}`;
    await ctx.reply(`Your store link:\n\n${link}\n\nShare with your customers!`, { parse_mode: 'Markdown', ...mainMenu });
});

bot.action('afiliados', async (ctx) => {
    await bot.telegram.sendMessage(ctx.chat.id, '/affiliate_link');
});

bot.action('saldo', async (ctx) => {
    await bot.telegram.sendMessage(ctx.chat.id, '/balance');
});

bot.action('planos', async (ctx) => {
    await ctx.reply(
        `EasyMall Plans\n\n` +
        `FREE - $0\n` +
        `• 30 days trial with FULL features\n` +
        `• 50% of balance available after trial\n` +
        `• Unlimited products\n\n` +
        `BASIC - $5/month\n` +
        `• 100% of balance available\n` +
        `• Unlimited products\n` +
        `• Affiliates (10% commission)\n` +
        `• Daily missions\n` +
        `• Global ranking\n` +
        `• Priority support\n\n` +
        `/subscribe_basic - Subscribe now`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

bot.action('ranking', async (ctx) => {
    await bot.telegram.sendMessage(ctx.chat.id, '/ranking');
});

bot.action('ajuda', async (ctx) => {
    await ctx.reply(
        `Help - EasyMall Commands\n\n` +
        `/start - Main menu\n` +
        `/create_store - Create your store\n` +
        `/add "Name" Price - Add product\n` +
        `/products - List products\n` +
        `/balance - Check balance\n` +
        `/withdraw AMOUNT - Withdraw balance\n` +
        `/subscribe_basic - Subscribe to BASIC\n` +
        `/affiliate_link - Get affiliate link\n` +
        `/my_commissions - View commissions\n` +
        `/ranking - Global ranking`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

bot.action('sair', async (ctx) => {
    await ctx.reply(`Goodbye! Use /start to return.`, { parse_mode: 'Markdown' });
});

// ============================================
// CHAT PRIVADO - IA RESPONDE
// ============================================

bot.on('text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    if (ctx.message.text.startsWith('/')) return;
    
    const nome = ctx.from.first_name;
    const mensagem = ctx.message.text;
    const idioma = ctx.from.language_code || 'en';
    
    const resposta = await easyMallResponder(mensagem, nome, idioma);
    
    if (resposta) {
        await ctx.reply(resposta, { parse_mode: 'Markdown', ...mainMenu });
    } else {
        await ctx.reply(`How can I help you, ${nome}? Use the buttons below.`, { parse_mode: 'Markdown', ...mainMenu });
    }
});

// ============================================
// WEBHOOK XROCKET
// ============================================

app.post('/webhook/xrocket', async (req, res) => {
    const { status, external_id, amount } = req.body;
    
    if (status === 'paid' && external_id && external_id.startsWith('basic_')) {
        const userId = parseInt(external_id.split('_')[1]);
        
        if (pool && dbConnected) {
            await query(`UPDATE usuarios SET plano = 'BASIC', plano_ativo = true WHERE id = $1`, [userId]);
        } else {
            const usuario = await getUsuario(userId);
            usuario.plano = 'BASIC';
            usuario.planoAtivo = true;
        }
        
        await registrarComissao(userId, 5);
        
        await bot.telegram.sendMessage(userId,
            `BASIC plan activated!\n\n` +
            `Now you have:\n` +
            `• 100% of your balance\n` +
            `• Affiliates (10% commission)\n` +
            `• Daily missions\n` +
            `• Global ranking\n\n` +
            `Start selling more today!`,
            { parse_mode: 'Markdown' }
        );
        
        await bot.telegram.sendMessage(ADMIN_ID,
            `New BASIC subscription\nUser: ${userId}\nAmount: ${amount} USDT`,
            { parse_mode: 'Markdown' }
        );
    }
    
    res.json({ ok: true });
});

// ============================================
// RELATORIO DIARIO PARA ADMIN
// ============================================

async function enviarRelatorioDiario() {
    let totalUsuarios = 0, totalLojas = 0, totalProdutos = 0;
    
    if (pool && dbConnected) {
        const u = await query(`SELECT COUNT(*) FROM usuarios`);
        const l = await query(`SELECT COUNT(*) FROM lojas`);
        const p = await query(`SELECT COUNT(*) FROM produtos`);
        totalUsuarios = parseInt(u.rows[0]?.count || 0);
        totalLojas = parseInt(l.rows[0]?.count || 0);
        totalProdutos = parseInt(p.rows[0]?.count || 0);
    } else {
        totalUsuarios = usuariosMemoria.size;
        totalLojas = lojasMemoria.size;
        totalProdutos = Array.from(produtosMemoria.values()).reduce((acc, p) => acc + p.length, 0);
    }
    
    await bot.telegram.sendMessage(ADMIN_ID,
        `Daily Report - EasyMall\n` +
        `Date: ${new Date().toLocaleDateString()}\n\n` +
        `Users: ${totalUsuarios}\n` +
        `Stores: ${totalLojas}\n` +
        `Products: ${totalProdutos}\n\n` +
        `System is running normally.`,
        { parse_mode: 'Markdown' }
    );
}

cron.schedule('59 23 * * *', () => enviarRelatorioDiario(), { timezone: "America/Sao_Paulo" });

// ============================================
// SERVIDOR
// ============================================

app.get('/', (req, res) => {
    res.json({ name: 'EasyMall Bot', version: '3.0.0', status: 'online' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`EasyMall Bot started!`);
    console.log(`Bot: @EasyMallBot`);
    console.log(`Admin ID: ${ADMIN_ID}`);
    console.log(`AI Gemini: ${GEMINI_API_KEY ? 'ACTIVE' : 'INACTIVE'}`);
    console.log(`Database: ${dbConnected ? 'NEON' : 'MEMORY'}`);
    bot.launch();
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
