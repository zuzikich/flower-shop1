require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2/promise');
const request = require('request');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
});

// Разбиваем список админов
const ADMINS = process.env.ADMIN_CHAT_ID.split(',').map(id => id.trim());

const userState = {}; 

const MENU = {
    reply_markup: {
        keyboard: [
            ['📂 Заказы', '🗄 Архив'],
            ['🌺 Товары', '📁 Категории'],
            ['📊 Статистика', '📦 Склад']
        ],
        resize_keyboard: true
    }
};

const CANCEL_KB = { reply_markup: { keyboard: [['❌ Отмена']], resize_keyboard: true, one_time_keyboard: true } };

bot.onText(/\/start/, (msg) => {
    if (!ADMINS.includes(msg.chat.id.toString())) return;
    bot.sendMessage(msg.chat.id, 'Админка готова.', MENU);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (!ADMINS.includes(chatId.toString())) return;
    
    const text = msg.text;

    if (text === '/cancel' || text === '❌ Отмена') {
        delete userState[chatId];
        return bot.sendMessage(chatId, 'Отменено.', MENU);
    }

    // Если ждем ввод (например, дату или название товара)
    if (userState[chatId]) {
        await handleInput(chatId, text, msg);
        return;
    }

    // --- 📊 СТАТИСТИКА (ОБНОВЛЕННАЯ) ---
    if (text === '📊 Статистика') {
        try {
            // 1. Статистика ЗА СЕГОДНЯ (CURDATE)
            const [today] = await pool.query(`
                SELECT COUNT(*) as cnt, SUM(total_price) as sum 
                FROM orders 
                WHERE status='completed' AND DATE(created_at) = CURDATE()
            `);

            // 2. Статистика ЗА ВЧЕРА (CURDATE - 1)
            const [yesterday] = await pool.query(`
                SELECT COUNT(*) as cnt, SUM(total_price) as sum 
                FROM orders 
                WHERE status='completed' AND DATE(created_at) = CURDATE() - INTERVAL 1 DAY
            `);

            // 3. ОБЩАЯ Статистика
            const [total] = await pool.query("SELECT COUNT(*) as cnt, SUM(total_price) as sum FROM orders WHERE status='completed'");
            const [active] = await pool.query("SELECT COUNT(*) as cnt FROM orders WHERE status='new'");
            const [products] = await pool.query("SELECT COUNT(*) as cnt, SUM(stock) as stock FROM products");

            // Форматирование цифр
            const revToday = today[0].sum || 0;
            const cntToday = today[0].cnt || 0;
            
            const revYest = yesterday[0].sum || 0;
            const cntYest = yesterday[0].cnt || 0;

            const revTotal = total[0].sum || 0;
            const cntTotal = total[0].cnt || 0;

            const msgText = `📊 <b>Статистика магазина:</b>\n\n` +
                            `🟢 <b>СЕГОДНЯ:</b>\n` +
                            `💰 Выручка: <b>${revToday.toLocaleString()} ₽</b>\n` +
                            `📦 Заказов: ${cntToday}\n\n` +
                            
                            `🟡 <b>ВЧЕРА:</b>\n` +
                            `💰 Выручка: <b>${revYest.toLocaleString()} ₽</b>\n` +
                            `📦 Заказов: ${cntYest}\n\n` +

                            `⚫️ <b>ЗА ВСЕ ВРЕМЯ:</b>\n` +
                            `💰 Выручка: ${revTotal.toLocaleString()} ₽\n` +
                            `📦 Выполнено: ${cntTotal}\n\n` +
                            
                            `🔥 <b>Активных заказов:</b> ${active[0].cnt}\n` +
                            `🌹 <b>Товаров на складе:</b> ${products[0].stock || 0} шт.`;

            // Добавляем кнопку "Выбрать дату"
            return bot.sendMessage(chatId, msgText, { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: '📅 Посмотреть другую дату', callback_data: 'stats_pick_date' }]]
                }
            });

        } catch (e) {
            return bot.sendMessage(chatId, 'Ошибка статистики: ' + e.message);
        }
    }

    // --- НАВИГАЦИЯ ---
    if (text === '📂 Заказы') { await showNewOrdersList(chatId); return; }
    if (text === '🗄 Архив') { await showArchiveList(chatId); return; }

    // --- КАТЕГОРИИ ---
    if (text === '📁 Категории') {
        bot.sendMessage(chatId, 'Управление категориями:', {
            reply_markup: {
                keyboard: [['➕ Создать категорию', '📜 Список категорий'], ['❌ Удалить категорию', '⬅️ Назад']],
                resize_keyboard: true
            }
        });
        return;
    }
    if (text === '⬅️ Назад') return bot.sendMessage(chatId, 'Главное меню', MENU);

    if (text === '➕ Создать категорию') {
        userState[chatId] = { action: 'ADD_CAT', step: 'NAME' };
        return bot.sendMessage(chatId, 'Название категории:', CANCEL_KB);
    }
    if (text === '📜 Список категорий') {
        const [rows] = await pool.query('SELECT id, title FROM categories');
        if (!rows.length) return bot.sendMessage(chatId, 'Нет категорий.');
        const list = rows.map(r => `🆔 ${r.id} | ${r.title}`).join('\n');
        return bot.sendMessage(chatId, `📂 <b>Категории:</b>\n${list}`, { parse_mode: 'HTML' });
    }
    if (text === '❌ Удалить категорию') {
        userState[chatId] = { action: 'DEL_CAT', step: 'ID' };
        return bot.sendMessage(chatId, 'ID категории для удаления:', CANCEL_KB);
    }

    // --- ТОВАРЫ ---
    if (text === '🌺 Товары') {
        bot.sendMessage(chatId, 'Управление товарами:', {
            reply_markup: {
                keyboard: [['➕ Добавить цветок', '❌ Удалить товар'], ['⬅️ Назад']],
                resize_keyboard: true
            }
        });
        return;
    }
    
    if (text === '➕ Добавить цветок') {
        const [cats] = await pool.query('SELECT * FROM categories');
        if (cats.length === 0) return bot.sendMessage(chatId, '⚠️ Сначала создайте категорию!');
        userState[chatId] = { action: 'ADD_PROD', step: 'NAME' };
        return bot.sendMessage(chatId, 'Название цветка:', CANCEL_KB);
    }

    if (text === '📦 Склад') {
        const [rows] = await pool.query('SELECT id, title FROM products');
        if (!rows.length) return bot.sendMessage(chatId, 'Пусто.', MENU);
        const kb = rows.map(p => ([{ text: `🆔 ${p.id} | ${p.title}`, callback_data: `edit_prod_${p.id}` }]));
        return bot.sendMessage(chatId, '📦 Выберите товар для редактирования:', { reply_markup: { inline_keyboard: kb } });
    }

    if (text === '❌ Удалить товар') {
        userState[chatId] = { action: 'DEL_PROD', step: 'ID' };
        return bot.sendMessage(chatId, 'Введите ID товара для удаления:', CANCEL_KB);
    }
});

async function handleInput(chatId, text, msg) {
    const state = userState[chatId];

    // 🔥 ПОИСК СТАТИСТИКИ ПО ДАТЕ
    if (state.action === 'STATS_DATE') {
        // Проверяем формат ДД.ММ.ГГГГ (простая проверка)
        if (!/^\d{2}\.\d{2}\.\d{4}$/.test(text)) {
            return bot.sendMessage(chatId, '⚠️ Неверный формат. Введите дату так: <b>01.02.2026</b>', {parse_mode: 'HTML'});
        }

        try {
            // STR_TO_DATE превращает "04.02.2026" в формат базы данных
            const [res] = await pool.query(`
                SELECT COUNT(*) as cnt, SUM(total_price) as sum 
                FROM orders 
                WHERE status='completed' AND DATE(created_at) = STR_TO_DATE(?, '%d.%m.%Y')
            `, [text]);

            const rev = res[0].sum || 0;
            const cnt = res[0].cnt || 0;

            const report = `📅 <b>Отчет за ${text}:</b>\n\n💰 Выручка: <b>${rev.toLocaleString()} ₽</b>\n📦 Выполнено заказов: ${cnt}`;
            
            bot.sendMessage(chatId, report, { parse_mode: 'HTML' });
            delete userState[chatId]; // Сбрасываем состояние
            
        } catch (e) {
            bot.sendMessage(chatId, 'Ошибка поиска: ' + e.message);
        }
        return;
    }
    
    // КАТЕГОРИИ
    if (state.action === 'ADD_CAT') {
        if (state.step === 'NAME') { state.name = text; state.step = 'PHOTO'; return bot.sendMessage(chatId, '📸 Фото категории:', CANCEL_KB); }
        if (state.step === 'PHOTO') {
            if (!msg.photo) return bot.sendMessage(chatId, 'Нужно фото.', CANCEL_KB);
            const link = await bot.getFileLink(msg.photo[msg.photo.length-1].file_id);
            request.get({ url: link, encoding: null }, async (err, res, buf) => {
                await pool.query('INSERT INTO categories (title, image) VALUES (?,?)', [state.name, buf]);
                bot.sendMessage(chatId, '✅ Категория создана!', MENU); delete userState[chatId];
            });
        }
        return;
    }
    if (state.action === 'DEL_CAT') {
        try {
            await pool.query('DELETE FROM categories WHERE id = ?', [parseInt(text)]);
            bot.sendMessage(chatId, 'Удалено.', MENU); 
        } catch (e) {
            bot.sendMessage(chatId, 'Ошибка (возможно, в категории есть товары).');
        }
        delete userState[chatId]; return;
    }

    // ТОВАРЫ
    if (state.action === 'ADD_PROD') {
        if (state.step === 'NAME') { state.name = text; state.step = 'DESC'; return bot.sendMessage(chatId, 'Описание:', CANCEL_KB); }
        if (state.step === 'DESC') { state.desc = text; state.step = 'PRICE'; return bot.sendMessage(chatId, 'Цена (число):', CANCEL_KB); }
        if (state.step === 'PRICE') { state.price = parseFloat(text.replace(',', '.')); if(isNaN(state.price)) return bot.sendMessage(chatId, 'Ошибка. Число.'); state.step = 'STOCK'; return bot.sendMessage(chatId, 'Количество (число):', CANCEL_KB); }
        if (state.step === 'STOCK') { state.stock = parseInt(text); if(isNaN(state.stock)) return bot.sendMessage(chatId, 'Ошибка. Число.'); state.step = 'PHOTO'; return bot.sendMessage(chatId, '📸 Фото товара:', CANCEL_KB); }
        if (state.step === 'PHOTO') {
            if (!msg.photo) return bot.sendMessage(chatId, 'Нужно фото.', CANCEL_KB);
            const link = await bot.getFileLink(msg.photo[msg.photo.length-1].file_id);
            request.get({ url: link, encoding: null }, async (err, res, buf) => {
                state.image = buf;
                const [cats] = await pool.query('SELECT id, title FROM categories');
                const kb = cats.map(c => ([{ text: c.title, callback_data: `select_cat_${c.id}` }]));
                bot.sendMessage(chatId, '📂 Выберите категорию:', { reply_markup: { inline_keyboard: kb } });
            });
        }
        return;
    }

    if (state.action === 'DEL_PROD') {
        const id = parseInt(text);
        if (isNaN(id)) return bot.sendMessage(chatId, '⛔️ Введите числовой ID.', CANCEL_KB);
        const [rows] = await pool.query('SELECT title FROM products WHERE id = ?', [id]);
        if (rows.length === 0) return bot.sendMessage(chatId, '⚠️ Товар не найден!', CANCEL_KB);
        await pool.query('DELETE FROM products WHERE id = ?', [id]);
        bot.sendMessage(chatId, `🗑 Товар "${rows[0].title}" удален.`, MENU);
        delete userState[chatId]; 
        return;
    }
    
    // РЕДАКТИРОВАНИЕ
    if (state.action === 'EDIT') {
        const pid = state.productId;
        
        if (state.field === 'image') {
            if (!msg.photo) return bot.sendMessage(chatId, '⚠️ Это не фото. Отправьте фото.', CANCEL_KB);
            const link = await bot.getFileLink(msg.photo[msg.photo.length-1].file_id);
            request.get({ url: link, encoding: null }, async (err, res, buf) => {
                await pool.query('UPDATE products SET image=? WHERE id=?', [buf, pid]);
                bot.sendMessage(chatId, '✅ Фото обновлено!', MENU);
                delete userState[chatId];
            });
            return;
        }

        if(state.field === 'price') await pool.query('UPDATE products SET price=? WHERE id=?', [parseFloat(text), pid]);
        else if(state.field === 'stock') await pool.query('UPDATE products SET stock=? WHERE id=?', [parseInt(text), pid]);
        else if(state.field === 'title') await pool.query('UPDATE products SET title=? WHERE id=?', [text, pid]);
        else if(state.field === 'description') await pool.query('UPDATE products SET description=? WHERE id=?', [text, pid]);
        
        bot.sendMessage(chatId, 'Обновлено!', MENU); delete userState[chatId];
    }
}

// --- CALLBACKS ---
bot.on('callback_query', async (q) => {
    const cid = q.message.chat.id;
    const mid = q.message.message_id;
    const d = q.data;

    if (!ADMINS.includes(cid.toString())) return;

    if (d.startsWith('select_cat_')) {
        const catId = d.split('_')[2];
        const state = userState[cid];
        if (state && state.action === 'ADD_PROD' && state.image) {
            await pool.query('INSERT INTO products (title, description, price, stock, image, mime_type, category_id) VALUES (?,?,?,?,?,?,?)', [state.name, state.desc, state.price, state.stock, state.image, 'image/jpeg', catId]);
            bot.sendMessage(cid, '✅ Товар добавлен!', MENU); delete userState[cid];
        }
    }

    if (d.startsWith('view_new_')) { await showOrderDetail(cid, d.split('_')[2], mid); }
    if (d === 'back_to_new') { await showNewOrdersList(cid, mid); }

    if (d.startsWith('close_')) {
        const orderId = d.split('_')[1];
        await pool.query("UPDATE orders SET status='completed' WHERE id=?", [orderId]);
        await bot.answerCallbackQuery(q.id, { text: 'Заказ выполнен!' });
        await showNewOrdersList(cid, mid);
    }

    if (d.startsWith('arch_view_')) { await showArchiveDetails(cid, d.split('_')[2], mid); }
    if (d === 'back_to_arch') { await bot.deleteMessage(cid, mid); await showArchiveList(cid); }
    if (d === 'hide_msg') { await bot.deleteMessage(cid, mid); }

    // 🔥 ВЫБОР ДАТЫ СТАТИСТИКИ
    if (d === 'stats_pick_date') {
        userState[cid] = { action: 'STATS_DATE' };
        bot.sendMessage(cid, '📅 Введите дату в формате <b>ДД.ММ.ГГГГ</b>\n(Например: 04.02.2026)', {
            parse_mode: 'HTML', 
            ...CANCEL_KB
        });
    }

    // РЕДАКТИРОВАНИЕ ТОВАРОВ
    if (d.startsWith('edit_prod_')) {
        const pid = d.split('_')[2];
        const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [pid]);
        if (!rows.length) return bot.sendMessage(cid, 'Товар не найден.');
        const p = rows[0];
        const txt = `✏️ <b>[ID: ${p.id}] ${p.title}</b>\n💰 ${p.price}\n📦 ${p.stock}`;
        
        const kb = [
            [{ text: 'Изм. Цену', callback_data: `ed_price_${pid}` }, { text: 'Изм. Остаток', callback_data: `ed_stock_${pid}` }],
            [{ text: 'Изм. Описание', callback_data: `ed_desc_${pid}` }],
            [{ text: '📷 Изм. Фото', callback_data: `ed_photo_${pid}` }]
        ];
        
        bot.sendMessage(cid, txt, { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
    }
    
    if (d.startsWith('ed_')) {
        const parts = d.split('_'); 
        const fieldMap = { 'price': 'price', 'stock': 'stock', 'desc': 'description', 'photo': 'image' };
        userState[cid] = { action: 'EDIT', productId: parts[2], field: fieldMap[parts[1]] };
        
        if (parts[1] === 'photo') {
            bot.sendMessage(cid, '📸 Отправьте новое фото товара:', CANCEL_KB);
        } else {
            bot.sendMessage(cid, `Введите новое значение:`, CANCEL_KB);
        }
    }
});

async function showNewOrdersList(chatId, messageId = null) {
    const [orders] = await pool.query("SELECT id, customer_name, total_price, created_at FROM orders WHERE status = 'new' ORDER BY created_at DESC");
    if (!orders.length) {
        if (messageId) return bot.editMessageText('✅ Все заказы выполнены! Новых нет.', { chat_id: chatId, message_id: messageId });
        return bot.sendMessage(chatId, '✅ Нет новых заказов.', MENU);
    }
    const kb = orders.map(o => ([{ text: `📦 #${o.id} | ${o.customer_name} | ${o.total_price} ₽`, callback_data: `view_new_${o.id}` }]));
    const text = `📋 <b>Активные заказы (${orders.length}):</b>\nВыберите заказ для просмотра:`;

    if (messageId) await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
    else await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
}

async function showOrderDetail(chatId, orderId, messageId) {
    const [orders] = await pool.query("SELECT * FROM orders WHERE id = ?", [orderId]);
    if (!orders.length) return bot.answerCallbackQuery(messageId, {text: 'Заказ не найден (возможно, удален)'});
    const order = orders[0];
    const [items] = await pool.query("SELECT p.title, oi.quantity FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?", [order.id]);
    const list = items.map(i => `${i.title} x${i.quantity}`).join('\n');
    const date = new Date(order.created_at).toLocaleString('ru-RU');
    const commentLine = order.comment ? `💬 <b>Комментарий:</b> ${order.comment}\n` : '';
    const msg = `📦 <b>Заказ #${order.id}</b>\n👤 ${order.customer_name}\n📱 ${order.phone}\n📍 ${order.contact_details}\n${commentLine}💰 ${order.total_price.toLocaleString()} ₽\n\n📋 <b>Товары:</b>\n${list}\n\n🕐 ${date}`;
    const kb = [[{ text: '✅ Выполнен', callback_data: `close_${order.id}` }], [{ text: '⬅️ Назад к списку', callback_data: 'back_to_new' }]];
    await bot.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
}

async function showArchiveList(chatId) {
    const [orders] = await pool.query("SELECT id, customer_name, total_price FROM orders WHERE status = 'completed' ORDER BY created_at DESC LIMIT 15");
    if (!orders.length) return bot.sendMessage(chatId, '🗄 Архив пуст.', MENU);
    const kb = orders.map(o => ([{ text: `#${o.id} | ${o.customer_name} | ${o.total_price} ₽`, callback_data: `arch_view_${o.id}` }]));
    await bot.sendMessage(chatId, '🗄 <b>Архив (последние 15):</b>', { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
}

async function showArchiveDetails(chatId, orderId, messageId) {
    const [orders] = await pool.query("SELECT * FROM orders WHERE id = ?", [orderId]);
    if (!orders.length) return;
    const order = orders[0];
    const [items] = await pool.query("SELECT p.title, oi.quantity FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?", [order.id]);
    const list = items.map(i => `${i.title} x${i.quantity}`).join('\n');
    const date = new Date(order.created_at).toLocaleString('ru-RU');
    const commentLine = order.comment ? `💬 <b>Комментарий:</b> ${order.comment}\n` : '';
    const msg = `🗄 <b>Архивный заказ #${order.id}</b>\n👤 ${order.customer_name}\n📱 ${order.phone}\n📍 ${order.contact_details}\n${commentLine}💰 ${order.total_price.toLocaleString()} ₽\n\n📋 <b>Товары:</b>\n${list}\n\n🕐 ${date}`;
    const kb = [[{ text: '⬅️ Назад к списку', callback_data: 'back_to_arch' }], [{ text: '❌ Скрыть', callback_data: 'hide_msg' }]];
    await bot.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
}