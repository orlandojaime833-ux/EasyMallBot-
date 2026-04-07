// ============================================
// EASYMALL BOT - ADVANCED FEATURES
// Separate file with all functionalities
// ============================================

// ============================================
// 1. SHOPPING CART
// ============================================

const cart = {
    async add(ctx, productId, quantity = 1) {
        if (!ctx.session.cart) ctx.session.cart = [];
        const existing = ctx.session.cart.find(item => item.id === productId);
        if (existing) {
            existing.quantity += quantity;
        } else {
            const product = await getProductById(productId);
            if (product) ctx.session.cart.push({ ...product, quantity });
        }
        return ctx.session.cart;
    },
    
    remove(ctx, productId) {
        if (!ctx.session.cart) return [];
        ctx.session.cart = ctx.session.cart.filter(item => item.id !== productId);
        return ctx.session.cart;
    },
    
    clear(ctx) {
        ctx.session.cart = [];
        return [];
    },
    
    getTotal(ctx) {
        if (!ctx.session.cart) return 0;
        return ctx.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    },
    
    list(ctx) {
        return ctx.session.cart || [];
    },
    
    async checkout(ctx, paymentMethod) {
        const total = this.getTotal(ctx);
        if (total === 0) return { error: 'Cart is empty' };
        const paymentLink = await generatePaymentLink(total, paymentMethod);
        return { success: true, total, paymentLink };
    }
};

// ============================================
// 2. DISCOUNT COUPONS
// ============================================

const coupons = {
    coupons: new Map(),
    
    create(code, discount, type = 'percent', expiresIn = 30, maxUses = 100) {
        this.coupons.set(code.toUpperCase(), {
            code: code.toUpperCase(),
            discount,
            type,
            expires: Date.now() + (expiresIn * 24 * 60 * 60 * 1000),
            uses: 0,
            maxUses,
            active: true
        });
        return true;
    },
    
    validate(code, total) {
        const coupon = this.coupons.get(code.toUpperCase());
        if (!coupon) return { valid: false, message: 'Coupon not found' };
        if (!coupon.active) return { valid: false, message: 'Coupon inactive' };
        if (Date.now() > coupon.expires) return { valid: false, message: 'Coupon expired' };
        if (coupon.uses >= coupon.maxUses) return { valid: false, message: 'Coupon usage limit reached' };
        
        let discount = coupon.type === 'percent' ? (total * coupon.discount / 100) : coupon.discount;
        return { valid: true, discount, finalTotal: total - discount, coupon };
    },
    
    apply(ctx, code, total) {
        const result = this.validate(code, total);
        if (result.valid) {
            ctx.session.coupon = result.coupon;
            ctx.session.discount = result.discount;
        }
        return result;
    },
    
    list() {
        return Array.from(this.coupons.values());
    }
};

// ============================================
// 3. DIGITAL PRODUCTS (AUTOMATIC DELIVERY)
// ============================================

const digitalProducts = {
    async add(storeId, name, price, downloadLink, licenseKey = null) {
        const productId = `dig_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        await saveProduct({ id: productId, storeId, name, price, type: 'digital', downloadLink, licenseKey });
        return productId;
    },
    
    async deliver(userId, productId) {
        const product = await getProductById(productId);
        if (!product || product.type !== 'digital') return { error: 'Product not found' };
        
        const tempLink = generateTempLink(product.downloadLink, 7);
        let license = product.licenseKey;
        if (product.licenseKey === 'auto') {
            license = generateLicense(userId, productId);
        }
        
        await sendMessage(userId, `✅ Your product is ready!\n📦 ${product.name}\n🔗 Link: ${tempLink}\n🔑 License: ${license || 'N/A'}`);
        return { success: true, link: tempLink, license };
    },
    
    async regenerate(userId, productId) {
        const sale = await getSale(userId, productId);
        if (!sale) return { error: 'Purchase not found' };
        return this.deliver(userId, productId);
    }
};

// ============================================
// 4. PRODUCT REVIEWS
// ============================================

const reviews = {
    reviews: new Map(),
    
    add(productId, userId, rating, comment = '') {
        if (rating < 1 || rating > 5) return { error: 'Rating must be between 1 and 5' };
        
        if (!this.reviews.has(productId)) this.reviews.set(productId, []);
        const review = { userId, rating, comment, date: new Date() };
        this.reviews.get(productId).push(review);
        
        this.updateAverage(productId);
        return { success: true, review };
    },
    
    updateAverage(productId) {
        const productReviews = this.reviews.get(productId) || [];
        const avg = productReviews.reduce((sum, r) => sum + r.rating, 0) / productReviews.length;
        updateProductRating(productId, avg);
        return avg;
    },
    
    list(productId, limit = 10) {
        const productReviews = this.reviews.get(productId) || [];
        return productReviews.slice(-limit).reverse();
    },
    
    summary(productId) {
        const productReviews = this.reviews.get(productId) || [];
        const avg = this.updateAverage(productId);
        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        productReviews.forEach(r => distribution[r.rating]++);
        return { average: avg, total: productReviews.length, distribution };
    }
};

// ============================================
// 5. WISHLIST
// ============================================

const wishlist = {
    add(ctx, productId) {
        if (!ctx.session.wishlist) ctx.session.wishlist = [];
        if (!ctx.session.wishlist.includes(productId)) {
            ctx.session.wishlist.push(productId);
        }
        return ctx.session.wishlist;
    },
    
    remove(ctx, productId) {
        if (!ctx.session.wishlist) return [];
        ctx.session.wishlist = ctx.session.wishlist.filter(id => id !== productId);
        return ctx.session.wishlist;
    },
    
    list(ctx) {
        return ctx.session.wishlist || [];
    },
    
    has(ctx, productId) {
        return (ctx.session.wishlist || []).includes(productId);
    },
    
    clear(ctx) {
        ctx.session.wishlist = [];
        return [];
    }
};

// ============================================
// 6. INVENTORY / STOCK
// ============================================

const stock = {
    stock: new Map(),
    
    set(productId, quantity) {
        this.stock.set(productId, { quantity, reserved: 0 });
        return true;
    },
    
    check(productId, quantity = 1) {
        const item = this.stock.get(productId);
        if (!item) return true;
        return (item.quantity - item.reserved) >= quantity;
    },
    
    reserve(productId, quantity = 1) {
        const item = this.stock.get(productId);
        if (!item) return true;
        if ((item.quantity - item.reserved) >= quantity) {
            item.reserved += quantity;
            return true;
        }
        return false;
    },
    
    confirm(productId, quantity = 1) {
        const item = this.stock.get(productId);
        if (!item) return true;
        item.quantity -= quantity;
        item.reserved -= quantity;
        return true;
    },
    
    cancel(productId, quantity = 1) {
        const item = this.stock.get(productId);
        if (item) item.reserved -= quantity;
        return true;
    },
    
    restock(productId, quantity) {
        const item = this.stock.get(productId);
        if (item) item.quantity += quantity;
        else this.stock.set(productId, { quantity, reserved: 0 });
        return true;
    }
};

// ============================================
// 7. SELLER LEVELS (GAMIFICATION)
// ============================================

const levels = {
    levels: [
        { id: 1, name: 'Beginner', minSales: 0, commission: 10, icon: '🌱' },
        { id: 2, name: 'Bronze', minSales: 10, commission: 9, icon: '🥉' },
        { id: 3, name: 'Silver', minSales: 50, commission: 8, icon: '🥈' },
        { id: 4, name: 'Gold', minSales: 100, commission: 7, icon: '🥇' },
        { id: 5, name: 'Platinum', minSales: 500, commission: 6, icon: '💎' },
        { id: 6, name: 'Diamond', minSales: 1000, commission: 5, icon: '👑' },
        { id: 7, name: 'Master', minSales: 5000, commission: 4, icon: '🏆' },
        { id: 8, name: 'Legendary', minSales: 10000, commission: 3, icon: '🌟' }
    ],
    
    getLevel(sales) {
        let current = this.levels[0];
        for (let i = this.levels.length - 1; i >= 0; i--) {
            if (sales >= this.levels[i].minSales) {
                current = this.levels[i];
                break;
            }
        }
        return current;
    },
    
    getNextLevel(sales) {
        for (let i = 0; i < this.levels.length; i++) {
            if (sales < this.levels[i].minSales) {
                return this.levels[i];
            }
        }
        return null;
    },
    
    getProgress(sales) {
        const next = this.getNextLevel(sales);
        if (!next) return { progress: 100, remaining: 0 };
        const prevMin = this.getLevel(sales).minSales;
        const needed = next.minSales - prevMin;
        const achieved = sales - prevMin;
        return { progress: Math.floor((achieved / needed) * 100), remaining: next.minSales - sales };
    }
};

// ============================================
// 8. DAILY MISSIONS
// ============================================

const missions = {
    missions: [
        { id: 'daily_1', name: 'First Sale', description: 'Make your first sale of the day', reward: 1, target: 1, type: 'sales' },
        { id: 'daily_2', name: 'Active Seller', description: 'Sell 3 products', reward: 2, target: 3, type: 'sales' },
        { id: 'daily_3', name: 'Sales Master', description: 'Sell 10 products', reward: 5, target: 10, type: 'sales' },
        { id: 'daily_4', name: 'Referrer', description: 'Refer a new merchant', reward: 3, target: 1, type: 'referral' },
        { id: 'daily_5', name: 'Sharer', description: 'Share your store in a group', reward: 1, target: 1, type: 'share' }
    ],
    
    completed: new Map(),
    
    getDailyMissions(userId) {
        const today = new Date().toDateString();
        const key = `${userId}_${today}`;
        if (!this.completed.has(key)) {
            this.completed.set(key, { missions: [], date: today });
        }
        return this.missions.map(m => ({
            ...m,
            completed: this.completed.get(key).missions.includes(m.id)
        }));
    },
    
    async complete(userId, missionId, ctx) {
        const missions = this.getDailyMissions(userId);
        const mission = missions.find(m => m.id === missionId);
        if (!mission || mission.completed) return false;
        
        const today = new Date().toDateString();
        const key = `${userId}_${today}`;
        const data = this.completed.get(key);
        data.missions.push(missionId);
        this.completed.set(key, data);
        
        await addBalance(userId, mission.reward);
        await ctx.reply(`🎉 Mission "${mission.name}" completed! +${mission.reward} TON`);
        return true;
    }
};

// ============================================
// 9. REPORTS (CSV/PDF)
// ============================================

const reports = {
    generateCSV(data, headers) {
        const csvRows = [headers.join(',')];
        for (const row of data) {
            const values = headers.map(h => `"${row[h] || ''}"`);
            csvRows.push(values.join(','));
        }
        return csvRows.join('\n');
    },
    
    async salesReport(storeId, period = 'month') {
        const sales = await getSalesByStore(storeId, period);
        const headers = ['Date', 'Product', 'Amount', 'Customer'];
        const data = sales.map(s => ({ Date: s.date, Product: s.product, Amount: s.amount, Customer: s.buyer }));
        return this.generateCSV(data, headers);
    },
    
    async customersReport(storeId) {
        const customers = await getCustomersByStore(storeId);
        const headers = ['ID', 'Name', 'Purchases', 'Total Spent', 'Last Purchase'];
        const data = customers.map(c => ({ ID: c.id, Name: c.name, Purchases: c.purchases, 'Total Spent': c.total, 'Last Purchase': c.lastPurchase }));
        return this.generateCSV(data, headers);
    },
    
    async productsReport(storeId) {
        const products = await getProductsByStore(storeId);
        const headers = ['ID', 'Name', 'Price', 'Sales', 'Revenue'];
        const data = products.map(p => ({ ID: p.id, Name: p.name, Price: p.price, Sales: p.sales, Revenue: p.revenue }));
        return this.generateCSV(data, headers);
    }
};

// ============================================
// 10. ADMIN PANEL
// ============================================

const admin = {
    // Check if user is admin
    isAdmin(userId) {
        return userId === ADMIN_ID;
    },
    
    // Get platform statistics
    async getStats() {
        const totalUsers = await countUsers();
        const totalStores = await countStores();
        const totalProducts = await countProducts();
        const totalSales = await countSales();
        const totalRevenue = await getTotalRevenue();
        const pendingWithdrawals = await getPendingWithdrawals();
        
        return { totalUsers, totalStores, totalProducts, totalSales, totalRevenue, pendingWithdrawals };
    },
    
    // Approve withdrawal
    async approveWithdrawal(withdrawalId) {
        const withdrawal = await getWithdrawal(withdrawalId);
        if (!withdrawal || withdrawal.status !== 'pending') return false;
        
        await updateWithdrawalStatus(withdrawalId, 'approved');
        await sendMessage(withdrawal.userId, `✅ Your withdrawal of ${withdrawal.amount} TON has been approved!`);
        return true;
    },
    
    // Ban user
    async banUser(userId) {
        await updateUserStatus(userId, 'banned');
        await sendMessage(userId, `❌ Your account has been banned. Contact support.`);
        return true;
    },
    
    // Unban user
    async unbanUser(userId) {
        await updateUserStatus(userId, 'active');
        await sendMessage(userId, `✅ Your account has been reinstated.`);
        return true;
    },
    
    // Broadcast message to all users
    async broadcast(message) {
        const allUsers = await getAllUsers();
        for (const user of allUsers) {
            await sendMessage(user.id, message);
        }
        return { success: true, sent: allUsers.length };
    },
    
    // Get all users (admin only)
    async getAllUsers() {
        return await query('SELECT id, name, type, plan, balance, total_earned FROM users ORDER BY created_at DESC');
    }
};

// ============================================
// 11. ABANDONED CART RECOVERY
// ============================================

const abandonedCart = {
    carts: new Map(),
    
    track(userId, cart) {
        this.carts.set(userId, { cart, lastActivity: Date.now() });
    },
    
    async checkAbandoned() {
        const now = Date.now();
        for (const [userId, data] of this.carts) {
            if (now - data.lastActivity > 60 * 60 * 1000) { // 1 hour
                await sendMessage(userId, `🛒 You left items in your cart! Use /cart to complete your purchase. 🎁 Use code SAVE10 for 10% off!`);
                this.carts.delete(userId);
            }
        }
    }
};

// ============================================
// EXPORT ALL MODULES
// ============================================

module.exports = {
    cart,
    coupons,
    digitalProducts,
    reviews,
    wishlist,
    stock,
    levels,
    missions,
    reports,
    admin,
    abandonedCart
};
