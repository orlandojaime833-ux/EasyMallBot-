// ============================================
// EASYMALL BOT - PLATAFORMA DE VENDAS NO TELEGRAM
// Versão: 3.0.0
// IA Gemini | Sistema de afiliados | Neon Database
// ============================================

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const cron = require('node-cron');
require('dotenv').config();

// ============ CONFIGURAÇÕES ============
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const XROCKET_API_KEY = process.env.XROCKET_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const GRUPO_CHAT_ID = parseInt(process.env.GRUPO_CHAT_ID) || null;
const PORT = process.env.PORT || 3000;

// Validação
if (!BOT_TOKEN) throw new Error('❌ BOT_TOKEN não configurado');
if (!ADMIN_ID) throw new Error('❌ ADMIN_ID não configurado');

// ============ INICIALIZAÇÃO ============
const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

// ============ BANCO DE DADOS (NEON POSTGRESQL) ============
let pool = null;
let dbConnected = false;

if (DATABASE_URL) {
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    
    pool.connect((err, client, release) => {
        if (err) {
            console.error('❌ Erro ao conectar ao Neon:', err.message);
            dbConnected = false;
        } else {
            console.log('✅ Conectado ao Neon (PostgreSQL)');
            dbConnected = true;
            release();
            initDatabase();
            initAfiliadosTables();
        }
    });
} else {
    console.log('⚠️ DATABASE_URL não configurado - usando memória');
}

// ============ FALLBACK EM MEMÓRIA ============
const usuariosMemoria = new Map();
const lojasMemoria = new Map();
const produtosMemoria = new Map();
const vendasMemoria = new Map();
const referralsMemoria = new Map();
const comissoesMemoria = new Map();

// ============ FUNÇÕES DE BANCO (com fallback) ============
async function query(sql, params = []) {
    if (pool && dbConnected) {
        try {
            const result = await pool.query(sql, params);
            return result;
        } catch (err) {
            console.error('❌ Erro na query:', err.message);
            return { rows: [] };
        }
    }
    return { rows: [] };
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
    
    // Memória
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

// ============ INICIALIZAÇÃO DO BANCO ============
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
    
    console.log('✅ Tabelas principais criadas');
}

// ============ SISTEMA DE AFILIADOS ============
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
    
    console.log('✅ Tabelas de afiliados criadas');
}

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
    
    const referral = await query('SELECT afiliado_id FROM referrals WHERE indicado_id = $1 AND status = \'ativo\'', [indicadoId]);
    if (referral.rows.length === 0) return;
    
    const afiliadoId = referral.rows[0].afiliado_id;
    const comissao = valor * 0.10;
    
    await query(
        `INSERT INTO comissoes (afiliado_id, valor, tipo, status, data_comissao) VALUES ($1, $2, 'assinatura', 'pendente', NOW())`,
        [afiliadoId, comissao]
    );
    
    await query(`UPDATE usuarios SET saldo_disponivel = saldo_disponivel + $1 WHERE id = $2`, [comissao, afiliadoId]);
    
    await bot.telegram.sendMessage(afiliadoId,
        `💰 *NOVA COMISSÃO!*\n\n👤 Um amigo assinou o plano BASIC.\n💵 Você ganhou R$ ${comissao.toFixed(2)} (10%)\n\n📊 /minhas_comissoes`,
        { parse_mode: 'Markdown' }
    );
}

// ============ IA GEMINI ============
async function callGemini(prompt) {
    if (!GEMINI_API_KEY) return null;
    
    try {
        const response = await axios.post(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.8, maxOutputTokens: 500, topP: 0.95 }
            },
            { params: { key: GEMINI_API_KEY }, headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
        );
        return response.data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (error) {
        console.error('❌ Erro IA:', error.message);
        return null;
    }
}

// ============ MENU PRINCIPAL ============
const mainMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🏪 MINHA LOJA', 'minha_loja'), Markup.button.callback('📦 PRODUTOS', 'produtos'), Markup.button.callback('➕ ADICIONAR', 'adicionar')],
    [Markup.button.callback('🔗 LINK DA LOJA', 'link_loja'), Markup.button.callback('👥 AFILIADOS', 'afiliados'), Markup.button.callback('📊 ESTATÍSTICAS', 'estatisticas')],
    [Markup.button.callback('💰 SALDO', 'saldo'), Markup.button.callback('🎯 MISSÕES', 'missoes'), Markup.button.callback('🏆 RANKING', 'ranking')],
    [Markup.button.callback('📤 SAQUE', 'solicitar_saque'), Markup.button.callback('🔗 INDICAR', 'indicar'), Markup.button.callback('💎 PLANOS', 'planos')],
    [Markup.button.callback('⚙️ CONFIG', 'config'), Markup.button.callback('❓ AJUDA', 'ajuda'), Markup.button.callback('🔙 SAIR', 'sair')]
]);

// ============ COMANDOS ============

// /start
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const nome = ctx.from.first_name;
    const payload = ctx.payload;
    
    // Processar link de afiliado
    if (payload && payload.startsWith('ref_')) {
        const afiliadoId = parseInt(payload.replace('ref_', ''));
        if (afiliadoId !== userId) {
            await processarIndicacao(userId, afiliadoId);
            await ctx.reply(`🎉 *Bem-vindo!*\n\nVocê foi indicado por um amigo!\n\nUse /criar_loja para começar.`, { parse_mode: 'Markdown' });
            return;
        }
    }
    
    const usuario = await getUsuario(userId);
    if (!usuario.nome && pool && dbConnected) {
        await query('UPDATE usuarios SET nome = $1 WHERE id = $2', [nome, userId]);
    }
    
    await ctx.reply(
        `🛍️ *EasyMall*: Olá ${nome}! Bem-vindo ao EasyMall.\n\n📌 Use os botões abaixo.\n💰 Plano: *${usuario.plano}*\n💵 Saldo: R$ ${usuario.saldo_disponivel || 0}`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

// Criar loja
bot.command('criar_loja', async (ctx) => {
    const userId = ctx.from.id;
    const nome = ctx.from.first_name;
    const lojaId = `loja_${userId}`;
    
    if (pool && dbConnected) {
        await query(`INSERT INTO lojas (id, dono_id, nome, criada) VALUES ($1, $2, $3, $4)`, [lojaId, userId, `Loja de ${nome}`, new Date()]);
    } else {
        lojasMemoria.set(lojaId, { id: lojaId, donoId: userId, nome: `Loja de ${nome}`, criada: new Date() });
        produtosMemoria.set(lojaId, []);
    }
    
    await ctx.reply(
        `✅ *LOJA CRIADA!*\n\n🏪 Nome: Loja de ${nome}\n🔗 Link: t.me/EasyMallBot?start=${lojaId}\n\n➕ Adicione produtos: /add "Nome" Preço`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

// Adicionar produto
bot.command('add', async (ctx) => {
    const userId = ctx.from.id;
    const match = ctx.message.text.match(/\/add "([^"]+)" (\d+(?:\.\d+)?)/);
    
    if (!match) {
        return ctx.reply(`❌ Use: /add "Nome do produto" Preço\nEx: /add "Curso JS" 49.90`, { parse_mode: 'Markdown' });
    }
    
    const produtoNome = match[1];
    const preco = parseFloat(match[2]);
    const lojaId = `loja_${userId}`;
    const produtoId = Date.now().toString();
    
    await addProduto(produtoId, lojaId, produtoNome, preco);
    
    await ctx.reply(
        `✅ *PRODUTO ADICIONADO!*\n\n📦 ${produtoNome}\n💰 R$ ${preco}\n🆔 ID: ${produtoId}`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

// Listar produtos
bot.command('produtos', async (ctx) => {
    const userId = ctx.from.id;
    const lojaId = `loja_${userId}`;
    const produtosLista = await getProdutos(lojaId);
    
    if (produtosLista.length === 0) {
        return ctx.reply(`📦 *Nenhum produto cadastrado*\n\nUse /add para adicionar.`, { parse_mode: 'Markdown', ...mainMenu });
    }
    
    let msg = `*📦 SEUS PRODUTOS:*\n\n`;
    for (let i = 0; i < produtosLista.length; i++) {
        const p = produtosLista[i];
        msg += `${i+1}. *${p.nome}* - R$ ${p.preco}\n   🆔 ${p.id}\n\n`;
    }
    
    await ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenu });
});

// Saldo
bot.action('saldo', async (ctx) => {
    const userId = ctx.from.id;
    const usuario = await getUsuario(userId);
    
    await ctx.reply(
        `💰 *SEU SALDO*\n\n💵 Total: R$ ${usuario.saldo_total || 0}\n✅ Disponível: R$ ${usuario.saldo_disponivel || 0}\n🔒 Retido: R$ ${(usuario.saldo_total || 0) - (usuario.saldo_disponivel || 0)}\n\n📤 /sacar VALOR`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

// Link de afiliado
bot.action('indicar', async (ctx) => {
    const userId = ctx.from.id;
    const link = gerarLinkAfiliado(userId);
    
    await ctx.reply(
        `🔗 *SEU LINK DE AFILIADO*\n\n${link}\n\n💰 *Comissão:* 10% de cada assinatura BASIC\n📈 *Vitalício:* Enquanto o indicado mantiver o plano\n\n📤 Compartilhe com amigos!\n📊 /minhas_comissoes`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

// Minhas comissões
bot.command('minhas_comissoes', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!pool || !dbConnected) {
        return ctx.reply(`📊 *COMISSÕES*\n\nSistema em memória: R$ 0,00\n\n🔗 /link_afiliado - Começar a ganhar`, { parse_mode: 'Markdown' });
    }
    
    const comissoes = await query(`SELECT * FROM comissoes WHERE afiliado_id = $1 ORDER BY data_comissao DESC`, [userId]);
    const total = comissoes.rows.reduce((sum, c) => sum + c.valor, 0);
    const pendentes = comissoes.rows.filter(c => c.status === 'pendente').reduce((sum, c) => sum + c.valor, 0);
    
    let msg = `💰 *MINHAS COMISSÕES*\n\n💵 Total: R$ ${total.toFixed(2)}\n⏳ Pendentes: R$ ${pendentes.toFixed(2)}\n\n📋 *Últimas:*\n`;
    for (const c of comissoes.rows.slice(0, 5)) {
        msg += `• R$ ${c.valor.toFixed(2)} - ${new Date(c.data_comissao).toLocaleDateString()}\n`;
    }
    msg += `\n🔗 /link_afiliado - Gerar link`;
    
    await ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenu });
});

// Ranking de afiliados
bot.command('ranking_afiliados', async (ctx) => {
    if (!pool || !dbConnected) {
        return ctx.reply(`🏆 *RANKING DE AFILIADOS*\n\nSistema em memória: sem dados\n\n🔗 /link_afiliado - Começar a ganhar`, { parse_mode: 'Markdown' });
    }
    
    const ranking = await query(`
        SELECT u.id, u.nome, COALESCE(SUM(c.valor), 0) as total
        FROM usuarios u
        LEFT JOIN comissoes c ON u.id = c.afiliado_id AND c.data_comissao >= date_trunc('month', NOW())
        GROUP BY u.id, u.nome
        ORDER BY total DESC
        LIMIT 10
    `);
    
    let msg = `🏆 *RANKING DE AFILIADOS (MÊS)*\n\n`;
    for (let i = 0; i < ranking.rows.length; i++) {
        const r = ranking.rows[i];
        const medalha = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '📌';
        msg += `${medalha} ${r.nome || r.id} - R$ ${parseFloat(r.total).toFixed(2)}\n`;
    }
    if (ranking.rows.length === 0) msg += `Nenhum afiliado ainda.\n`;
    msg += `\n🔗 /link_afiliado - Começar a ganhar`;
    
    await ctx.reply(msg, { parse_mode: 'Markdown', ...mainMenu });
});

// Planos
bot.action('planos', async (ctx) => {
    await ctx.reply(
        `💎 *PLANOS EASYMALL*\n\n🏪 *FREE* - R$ 0\n• 30 dias de teste\n• 50% do saldo disponível\n• Produtos ilimitados\n\n👑 *BASIC* - R$ 5/mês\n• 100% do saldo disponível\n• Produtos ilimitados\n• Afiliados e missões\n• Ranking global\n\n/assinar_basic - Assinar BASIC`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

// Assinar BASIC
bot.command('assinar_basic', async (ctx) => {
    const userId = ctx.from.id;
    
    // Simular pagamento (aqui você integra com xRocket)
    await query(`UPDATE usuarios SET plano = 'BASIC', plano_ativo = true WHERE id = $1`, [userId]);
    
    // Registrar comissão para quem indicou
    await registrarComissao(userId, 5);
    
    await ctx.reply(
        `✅ *PLANO BASIC ATIVADO!*\n\n🎉 Agora você tem:\n• 100% do saldo disponível\n• Comissão reduzida\n• Afiliados e missões\n\n💰 Convide amigos e ganhe 10%: /link_afiliado`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

// Saque
bot.command('sacar', async (ctx) => {
    const userId = ctx.from.id;
    const valor = parseFloat(ctx.message.text.split(' ')[1]);
    const usuario = await getUsuario(userId);
    
    if (isNaN(valor) || valor < 10) {
        return ctx.reply(`❌ Use: /sacar VALOR (mínimo R$ 10,00)`, { parse_mode: 'Markdown' });
    }
    
    if (valor > (usuario.saldo_disponivel || 0)) {
        return ctx.reply(`❌ Saldo insuficiente. Disponível: R$ ${usuario.saldo_disponivel || 0}`, { parse_mode: 'Markdown' });
    }
    
    const novoSaldo = (usuario.saldo_disponivel || 0) - valor;
    if (pool && dbConnected) {
        await query(`UPDATE usuarios SET saldo_disponivel = $1 WHERE id = $2`, [novoSaldo, userId]);
    } else {
        usuario.saldo_disponivel = novoSaldo;
    }
    
    await ctx.reply(
        `✅ *SAQUE SOLICITADO!*\n\n💰 Valor: R$ ${valor.toFixed(2)}\n📅 Data: ${new Date().toLocaleString()}\n\n⏳ Aguarde aprovação do administrador.`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
    
    await bot.telegram.sendMessage(ADMIN_ID,
        `📤 *SAQUE SOLICITADO*\n👤 ${ctx.from.first_name}\n🆔 ID: ${userId}\n💰 R$ ${valor.toFixed(2)}`,
        { parse_mode: 'Markdown' }
    );
});

// Ações dos botões
bot.action('minha_loja', async (ctx) => {
    const userId = ctx.from.id;
    const lojaId = `loja_${userId}`;
    const produtosLista = await getProdutos(lojaId);
    await ctx.reply(`🏪 *MINHA LOJA*\n\n📦 Produtos: ${produtosLista.length}\n🔗 Link: t.me/EasyMallBot?start=${lojaId}`, { parse_mode: 'Markdown', ...mainMenu });
});

bot.action('produtos', async (ctx) => { await bot.telegram.sendMessage(ctx.chat.id, '/produtos'); });
bot.action('adicionar', async (ctx) => { await ctx.reply(`➕ Use: /add "Nome" Preço`, { parse_mode: 'Markdown', ...mainMenu }); });
bot.action('link_loja', async (ctx) => { const link = `https://t.me/EasyMallBot?start=loja_${ctx.from.id}`; await ctx.reply(`🔗 ${link}`, { parse_mode: 'Markdown', ...mainMenu }); });
bot.action('afiliados', async (ctx) => { await bot.telegram.sendMessage(ctx.chat.id, '/link_afiliado'); });
bot.action('estatisticas', async (ctx) => { await ctx.reply(`📊 *ESTATÍSTICAS*\n\nUse /produtos e /minhas_comissoes`, { parse_mode: 'Markdown', ...mainMenu }); });
bot.action('missoes', async (ctx) => { await ctx.reply(`🎯 *MISSÕES*\n\nMissão de hoje: vender 3 produtos!\nRecompensa: R$ 10`, { parse_mode: 'Markdown', ...mainMenu }); });
bot.action('ranking', async (ctx) => { await bot.telegram.sendMessage(ctx.chat.id, '/ranking_afiliados'); });
bot.action('solicitar_saque', async (ctx) => { await ctx.reply(`📤 Use: /sacar VALOR\nMínimo: R$ 10,00`, { parse_mode: 'Markdown', ...mainMenu }); });
bot.action('config', async (ctx) => { await ctx.reply(`⚙️ /config nome "Nome" - Mudar nome\n/config wallet "WALLET" - Configurar carteira`, { parse_mode: 'Markdown', ...mainMenu }); });
bot.action('ajuda', async (ctx) => { await ctx.reply(`❓ *AJUDA*\n\n/start - Menu\n/criar_loja - Criar loja\n/add - Adicionar produto\n/produtos - Listar\n/saldo - Ver saldo\n/sacar - Sacar\n/link_afiliado - Indicar amigos`, { parse_mode: 'Markdown', ...mainMenu }); });
bot.action('sair', async (ctx) => { await ctx.reply(`🛍️ Até logo! Use /start para voltar.`, { parse_mode: 'Markdown' }); });

// Relatório diário para admin
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
        `📊 *RELATÓRIO DIÁRIO - EASYMALL*\n📅 ${new Date().toLocaleDateString()}\n\n👥 Usuários: ${totalUsuarios}\n🏪 Lojas: ${totalLojas}\n📦 Produtos: ${totalProdutos}\n\n✅ Sistema operacional normalmente.`,
        { parse_mode: 'Markdown' }
    );
}

cron.schedule('59 23 * * *', () => enviarRelatorioDiario(), { timezone: "America/Sao_Paulo" });

// ============ SERVIDOR ============
app.get('/', (req, res) => { res.json({ nome: 'EasyMall Bot', versao: '3.0.0', status: 'online' }); });

app.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
    console.log(`🚀 EasyMall Bot iniciado!`);
    console.log(`🤖 Bot: @EasyMallBot`);
    console.log(`👑 Admin ID: ${ADMIN_ID}`);
    console.log(`🧠 IA Gemini: ${GEMINI_API_KEY ? 'ATIVA' : 'INATIVA'}`);
    console.log(`💾 Banco: ${dbConnected ? 'NEON' : 'MEMÓRIA'}`);
    bot.launch();
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
