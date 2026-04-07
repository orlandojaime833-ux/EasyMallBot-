// ============================================
// EASYMALL BOT - WITH GEMINI AI
// All AI functions integrated
// ============================================

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');
require('dotenv').config();

// ============================================
// CONFIGURATION
// ============================================

const BOT_TOKEN = process.env.BOT_TOKEN || '8715965933:AAGPxTbFrGTsrx8IKPHlQX_MdIsMkJSUMVU';
const ADMIN_ID = parseInt(process.env.ADMIN_ID) || 7991785009;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBbFcGJYvNN-b-i2tlkiZrY7jZ_pjEij4A';

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

// ============================================
// AI GEMINI CORE FUNCTIONS
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
        console.error('AI Error:', error.message);
        return null;
    }
}

// ============================================
// AI FUNCTION 1: WELCOME MESSAGE
// ============================================

async function aiWelcome(userName, language = 'en') {
    const prompt = `
You are EasyMall, a global sales platform on Telegram.

Create a welcome message for ${userName}.

Include:
- Greeting with their name
- Brief explanation of EasyMall
- Mention: FREE plan (30 days trial with full features)
- Mention: BASIC plan ($5/month)
- Ask what they want to do first

Language: ${language}
Use emojis. Be friendly and professional.

Response:`;
    return await callGemini(prompt);
}

// ============================================
// AI FUNCTION 2: CREATE PRODUCT DESCRIPTION
// ============================================

async function aiGenerateProductDescription(productName, language = 'en') {
    const prompt = `
You are a professional copywriter for EasyMall.

Create a product description for: "${productName}"

Requirements:
- Maximum 200 characters
- Use emojis
- Highlight 2-3 benefits
- Be persuasive
- Include a call to action

Language: ${language}

Description:`;
    return await callGemini(prompt);
}

// ============================================
// AI FUNCTION 3: SUGGEST PRICE
// ============================================

async function aiSuggestPrice(productName, language = 'en') {
    const prompt = `
Suggest a fair price in USDT for: "${productName}"

Consider:
- Similar products cost between $10 and $100
- Digital products: $20-$50
- Courses: $30-$100
- Ebooks: $10-$30

Return ONLY the number (example: 49.90)

Price:`;
    const response = await callGemini(prompt);
    const price = parseFloat(response);
    return isNaN(price) ? 29.90 : price;
}

// ============================================
// AI FUNCTION 4: ANSWER QUESTIONS
// ============================================

async function aiAnswerQuestion(question, userName, language = 'en') {
    const prompt = `
You are EasyMall, a sales platform on Telegram.

User: ${userName}
Question: "${question}"

Answer in a helpful, practical way in ${language}.
Keep it short (max 300 characters).
Use emojis.
Offer additional help at the end.

Response:`;
    return await callGemini(prompt);
}

// ============================================
// AI FUNCTION 5: SALES TIPS
// ============================================

async function aiSalesTips(userName, productsCount, salesCount, language = 'en') {
    const prompt = `
You are a sales consultant for EasyMall.

User: ${userName}
Products in store: ${productsCount}
Sales so far: ${salesCount}

Give 3 practical tips to increase sales in ${language}.
Be specific and actionable.
Use emojis.

Response:`;
    return await callGemini(prompt);
}

// ============================================
// AI FUNCTION 6: EXPLAIN PLANS
// ============================================

async function aiExplainPlans(userName, currentPlan, language = 'en') {
    const prompt = `
You are EasyMall.

User: ${userName}
Current plan: ${currentPlan}

Explain the plans:
- FREE: $0, 30 days trial with full features, 50% balance after trial
- BASIC: $5/month, 100% balance, affiliates, missions, ranking

Help the user decide which plan is best for them.
Be honest and helpful.
Language: ${language}

Response:`;
    return await callGemini(prompt);
}

// ============================================
// AI FUNCTION 7: ANALYZE SENTIMENT
// ============================================

async function aiAnalyzeSentiment(message) {
    const prompt = `
Analyze the sentiment of this message: "${message}"

Respond with ONLY one word: POSITIVE, NEUTRAL, or NEGATIVE

Sentiment:`;
    return await callGemini(prompt);
}

// ============================================
// AI FUNCTION 8: TRANSLATE (auto-detect)
// ============================================

async function aiTranslate(text, targetLanguage) {
    const prompt = `
Translate this text to ${targetLanguage}:
"${text}"

Keep emojis and formatting.

Translation:`;
    return await callGemini(prompt);
}

// ============================================
// AI FUNCTION 9: STORE SETUP GUIDE
// ============================================

async function aiStoreSetupGuide(userName, language = 'en') {
    const prompt = `
You are EasyMall.

User: ${userName} is creating a new store.

Give a 3-step guide to set up their store:
1. Store name
2. Add products
3. Share store link

Be encouraging and practical.
Language: ${language}

Response:`;
    return await callGemini(prompt);
}

// ============================================
// AI FUNCTION 10: MOTIVATIONAL MESSAGE
// ============================================

async function aiMotivationalMessage(userName, salesCount, language = 'en') {
    const prompt = `
You are EasyMall.

User: ${userName}
Sales count: ${salesCount}

Create a motivational message to encourage them to keep selling.
Celebrate their achievements.
Suggest a next goal.
Language: ${language}

Response:`;
    return await callGemini(prompt);
}

// ============================================
// BUTTON MENU
// ============================================

const mainMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🏪 MY STORE', 'my_store'), Markup.button.callback('📦 PRODUCTS', 'products')],
    [Markup.button.callback('✨ ADD PRODUCT', 'add_product'), Markup.button.callback('🔗 STORE LINK', 'store_link')],
    [Markup.button.callback('🤝 AFFILIATES', 'affiliates'), Markup.button.callback('💰 BALANCE', 'balance')],
    [Markup.button.callback('💎 PLANS', 'plans'), Markup.button.callback('🏆 RANKING', 'ranking')],
    [Markup.button.callback('❓ HELP', 'help'), Markup.button.callback('🔙 EXIT', 'exit')]
]);

// ============================================
// COMMANDS WITH AI
// ============================================

// Start command
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.first_name;
    const language = ctx.from.language_code || 'en';
    
    const welcomeMessage = await aiWelcome(userName, language);
    
    await ctx.reply(welcomeMessage || `Welcome to EasyMall, ${userName}!\n\nUse the buttons below.`, {
        parse_mode: 'Markdown',
        ...mainMenu
    });
});

// Create store command
bot.command('create_store', async (ctx) => {
    const userName = ctx.from.first_name;
    const language = ctx.from.language_code || 'en';
    
    const guide = await aiStoreSetupGuide(userName, language);
    
    await ctx.reply(guide || `Let's create your store!\n\n1. Choose a name\n2. Add products with /add\n3. Share your link`, {
        parse_mode: 'Markdown',
        ...mainMenu
    });
});

// Add product with AI
bot.command('add', async (ctx) => {
    const match = ctx.message.text.match(/\/add "([^"]+)" (\d+(?:\.\d+)?)/);
    
    if (!match) {
        return ctx.reply(`Use: /add "Product Name" Price\nExample: /add "JavaScript Course" 49.90`, { parse_mode: 'Markdown' });
    }
    
    const productName = match[1];
    const userPrice = parseFloat(match[2]);
    const language = ctx.from.language_code || 'en';
    
    // AI generates description and suggests price
    const description = await aiGenerateProductDescription(productName, language);
    const suggestedPrice = await aiSuggestPrice(productName, language);
    
    const finalPrice = userPrice || suggestedPrice;
    
    await ctx.reply(
        `✨ *Product Ready*\n\n` +
        `📦 *Name:* ${productName}\n` +
        `📝 *Description:* ${description || 'High quality product'}\n` +
        `💰 *Price:* ${finalPrice} USDT\n\n` +
        `✅ Product added successfully!`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

// Products list
bot.command('products', async (ctx) => {
    await ctx.reply(`📦 *Your Products*\n\nNo products yet.\n\nUse /add to add your first product.`, {
        parse_mode: 'Markdown',
        ...mainMenu
    });
});

// Balance
bot.command('balance', async (ctx) => {
    await ctx.reply(`💰 *Your Balance*\n\nTotal: 0 USDT\nAvailable: 0 USDT\n\n/withdraw AMOUNT - Withdraw`, {
        parse_mode: 'Markdown',
        ...mainMenu
    });
});

// Plans with AI
bot.command('plans', async (ctx) => {
    const userName = ctx.from.first_name;
    const language = ctx.from.language_code || 'en';
    
    const plansExplanation = await aiExplainPlans(userName, 'FREE', language);
    
    await ctx.reply(plansExplanation || `💎 *Plans*\n\nFREE - $0\nBASIC - $5/month\n\n/subscribe_basic`, {
        parse_mode: 'Markdown',
        ...mainMenu
    });
});

// Help with AI
bot.command('help', async (ctx) => {
    const userName = ctx.from.first_name;
    const language = ctx.from.language_code || 'en';
    
    const helpMessage = await aiAnswerQuestion('Tell me the main commands and how to get started', userName, language);
    
    await ctx.reply(helpMessage || `❓ *Help*\n\n/start - Menu\n/create_store - Create store\n/add - Add product\n/products - List products\n/balance - Check balance`, {
        parse_mode: 'Markdown',
        ...mainMenu
    });
});

// Sales tips
bot.command('sales_tips', async (ctx) => {
    const userName = ctx.from.first_name;
    const language = ctx.from.language_code || 'en';
    
    const tips = await aiSalesTips(userName, 0, 0, language);
    
    await ctx.reply(tips || `💡 *Sales Tips*\n\n1. Add product images\n2. Offer discounts\n3. Share your store link in groups`, {
        parse_mode: 'Markdown',
        ...mainMenu
    });
});

// Affiliate link
bot.command('affiliate_link', async (ctx) => {
    const userId = ctx.from.id;
    const link = `https://t.me/EasyMallBot?start=ref_${userId}`;
    
    await ctx.reply(
        `🤝 *Your Affiliate Link*\n\n${link}\n\nCommission: 10% of each BASIC subscription\nShare with friends!`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

// ============================================
// BUTTON ACTIONS
// ============================================

bot.action('my_store', async (ctx) => {
    await ctx.reply(`🏪 *My Store*\n\nStore ID: store_${ctx.from.id}\nPlan: FREE\nBalance: 0 USDT\n\nUse /create_store to create your store.`, { parse_mode: 'Markdown', ...mainMenu });
});

bot.action('products', async (ctx) => {
    await bot.telegram.sendMessage(ctx.chat.id, '/products');
});

bot.action('add_product', async (ctx) => {
    await ctx.reply(`✨ *Add Product*\n\nUse: /add "Product Name" Price\nExample: /add "JavaScript Course" 49.90\n\nAI will help with description!`, { parse_mode: 'Markdown', ...mainMenu });
});

bot.action('store_link', async (ctx) => {
    const link = `https://t.me/EasyMallBot?start=store_${ctx.from.id}`;
    await ctx.reply(`🔗 *Your Store Link*\n\n${link}\n\nShare with your customers!`, { parse_mode: 'Markdown', ...mainMenu });
});

bot.action('affiliates', async (ctx) => {
    await bot.telegram.sendMessage(ctx.chat.id, '/affiliate_link');
});

bot.action('balance', async (ctx) => {
    await bot.telegram.sendMessage(ctx.chat.id, '/balance');
});

bot.action('plans', async (ctx) => {
    await bot.telegram.sendMessage(ctx.chat.id, '/plans');
});

bot.action('ranking', async (ctx) => {
    await ctx.reply(`🏆 *Global Ranking*\n\nNo affiliates yet.\n\nBe the first to appear here!`, { parse_mode: 'Markdown', ...mainMenu });
});

bot.action('help', async (ctx) => {
    await bot.telegram.sendMessage(ctx.chat.id, '/help');
});

bot.action('exit', async (ctx) => {
    await ctx.reply(`👋 Goodbye! Use /start to return.`, { parse_mode: 'Markdown' });
});

// ============================================
// AI RESPONDS TO ANY TEXT
// ============================================

bot.on('text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    if (ctx.message.text.startsWith('/')) return;
    
    const message = ctx.message.text;
    const userName = ctx.from.first_name;
    const language = ctx.from.language_code || 'en';
    
    // Analyze sentiment first
    const sentiment = await aiAnalyzeSentiment(message);
    
    if (sentiment === 'NEGATIVE') {
        await bot.telegram.sendMessage(ADMIN_ID, `⚠️ Negative sentiment from ${userName}: ${message}`);
    }
    
    const response = await aiAnswerQuestion(message, userName, language);
    
    await ctx.reply(response || `How can I help you, ${userName}? Use the buttons below.`, {
        parse_mode: 'Markdown',
        ...mainMenu
    });
});

// ============================================
// WEBHOOK XROCKET
// ============================================

app.post('/webhook/xrocket', async (req, res) => {
    const { status, external_id } = req.body;
    
    if (status === 'paid' && external_id && external_id.startsWith('basic_')) {
        const userId = parseInt(external_id.split('_')[1]);
        await bot.telegram.sendMessage(userId, `✅ *BASIC Plan Activated!*\n\nNow you have 100% of your balance and affiliate features.`, { parse_mode: 'Markdown' });
        await bot.telegram.sendMessage(ADMIN_ID, `💰 New BASIC subscription: User ${userId}`);
    }
    
    res.json({ ok: true });
});

// ============================================
// SERVER
// ============================================

app.get('/', (req, res) => {
    res.json({ name: 'EasyMall Bot', version: '3.0.0', status: 'online', ai: 'Gemini Active' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`EasyMall Bot started with Gemini AI`);
    console.log(`Bot: @EasyMallBot`);
    console.log(`AI Functions: Welcome, Products, Prices, Support, Translation, Sentiment Analysis`);
    bot.launch();
});
