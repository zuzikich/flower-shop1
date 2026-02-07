require('dotenv').config();
// Подключаем бота, чтобы он работал в том же процессе
try {
    require('./bot.js');
    console.log('Bot started successfully');
} catch (e) {
    console.error('ERROR STARTING BOT:', e.message);
}

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
});

// --- API ТОВАРОВ ---
app.get('/api/products', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, title, description, price, stock, category_id FROM products');
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/image/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT image, mime_type FROM products WHERE id = ?', [req.params.id]);
        if (rows.length > 0 && rows[0].image) {
            res.setHeader('Content-Type', rows[0].mime_type || 'image/jpeg');
            res.send(rows[0].image);
        } else { res.status(404).send('Not found'); }
    } catch (e) { res.status(500).send(e.message); }
});

// --- API КАТЕГОРИЙ ---
app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, title FROM categories');
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/category-image/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT image FROM categories WHERE id = ?', [req.params.id]);
        if (rows.length > 0 && rows[0].image) {
            res.setHeader('Content-Type', 'image/jpeg');
            res.send(rows[0].image);
        } else { res.status(404).send('Not found'); }
    } catch (e) { res.status(500).send(e.message); }
});

// --- API ЗАКАЗОВ ---
app.post('/api/orders', async (req, res) => {
    const { name, phone, details, cart } = req.body;
    if (!cart || cart.length === 0) return res.status(400).json({ error: 'Корзина пуста' });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        let total = 0;
        
        for (let item of cart) {
            const [prod] = await connection.query('SELECT price, stock, title FROM products WHERE id = ?', [item.id]);
            if (prod.length === 0 || prod[0].stock < item.qty) throw new Error(`Мало товара: ${prod[0]?.title}`);
            total += prod[0].price * item.qty;
        }

        const [orderResult] = await connection.query(
            'INSERT INTO orders (customer_name, phone, contact_details, total_price, status) VALUES (?, ?, ?, ?, ?)',
            [name, phone, details, total, 'new']
        );
        const orderId = orderResult.insertId;

        for (let item of cart) {
            const [prod] = await connection.query('SELECT price FROM products WHERE id = ?', [item.id]);
            await connection.query(
                'INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase) VALUES (?, ?, ?, ?)',
                [orderId, item.id, item.qty, prod[0].price]
            );
            await connection.query('UPDATE products SET stock = stock - ? WHERE id = ?', [item.qty, item.id]);
        }

        await connection.commit();

        // Уведомление ВСЕМ админам (Исправленная часть)
        try {
            const TelegramBot = require('node-telegram-bot-api');
            const tempBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
            
            const messageText = `⚡️ <b>Новый заказ #${orderId}</b>\n👤 ${name}\n💰 ${total.toLocaleString()} ₽\n\nЗайдите в "📂 Заказы".`;
            
            // Разбиваем строку админов на массив
            const adminIds = process.env.ADMIN_CHAT_ID.split(',').map(id => id.trim());

            // Отправляем каждому в цикле
            for (const adminId of adminIds) {
                tempBot.sendMessage(adminId, messageText, { parse_mode: 'HTML' })
                       .catch(err => console.error(`Ошибка отправки админу ${adminId}:`, err.message));
            }

        } catch (botErr) {
            console.error('Ошибка логики отправки:', botErr.message);
        }

        res.json({ success: true, orderId });

    } catch (e) {
        await connection.rollback();
        res.status(500).json({ error: e.message });
    } finally {
        connection.release();
    }
});

// ЗАПУСК СЕРВЕРА
// Без жесткой привязки к IPv4 ('0.0.0.0'), чтобы работало на IPv6 хостингах
const PORT = process.env.PORT || 8100;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});