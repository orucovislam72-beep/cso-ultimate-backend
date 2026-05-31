const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Защита от огромных JSON
app.use(express.json({ limit: '100kb' }));
app.use(cors());

// ============ ПРОВЕРКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ ============
const API_KEY = process.env.API_KEY || 'cso-uitra-Haga2026';
if (!process.env.API_KEY) {
    console.warn('⚠️ API_KEY не задан, используется стандартный ключ');
}

const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error('❌ MONGODB_URI не задана!');
    process.exit(1);
}

// ============ MIDDLEWARE АВТОРИЗАЦИИ ============
app.use('/api', (req, res, next) => {
    const clientKey = req.headers['x-api-key'];
    if (clientKey !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
});

let db;
let players;
let market;
let friends;
let client;

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============
function isValidPrice(price) {
    return typeof price === 'number' && !isNaN(price) && price > 0;
}

function isValidObjectId(id) {
    return ObjectId.isValid(id);
}

function isValidNickname(nickname) {
    return typeof nickname === 'string' && 
           nickname.length >= 3 && 
           nickname.length <= 20 &&
           /^[a-zA-Z0-9а-яА-Я_]+$/.test(nickname);
}

function isValidSkin(skin) {
    return typeof skin === 'string' && skin.trim().length > 0 && skin.length <= 100;
}

function hasAllFields(obj, fields) {
    return fields.every(field => obj[field] !== undefined);
}

// ============ ПОДКЛЮЧЕНИЕ К MONGODB ============
async function connectToMongo() {
    try {
        client = new MongoClient(uri);
        await client.connect();
        db = client.db('cso_ultimate');
        players = db.collection('players');
        market = db.collection('market');
        friends = db.collection('friends');
        
        // Индексы
        await players.createIndex({ nickname: 1 }, { unique: true });
        await market.createIndex({ createdAt: -1 });
        await friends.createIndex({ from: 1, to: 1 }, { unique: true });
        
        console.log('✅ Подключено к MongoDB');
    } catch (err) {
        console.error('❌ Ошибка подключения:', err);
        process.exit(1);
    }
}

// ============ HEALTH CHECK ============
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        database: !!db,
        version: 'ultimate-2.0'
    });
});

// ============ ТОП ИГРОКОВ ============
app.get('/api/top', async (req, res) => {
    try {
        const top = await players
            .find({}, { projection: { nickname: 1, kills: 1, coins: 1, level: 1 } })
            .sort({ kills: -1 })
            .limit(10)
            .toArray();
        res.json(top);
    } catch (err) {
        console.error('Ошибка /api/top:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============ ОБНОВЛЕНИЕ ИГРОКА ============
app.post('/api/player', async (req, res) => {
    const { nickname, kills, coins, level } = req.body;
    if (!nickname || !isValidNickname(nickname)) {
        return res.status(400).json({ error: 'Никнейм должен быть от 3 до 20 символов (буквы, цифры, _)' });
    }
    
    try {
        const updateData = { lastUpdated: new Date() };
        if (typeof kills === 'number' && kills >= 0) updateData.kills = kills;
        if (typeof coins === 'number' && coins >= 0) updateData.coins = coins;
        if (typeof level === 'number' && level >= 1) updateData.level = level;
        
        await players.updateOne(
            { nickname },
            { $set: updateData },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка /api/player:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============ РЫНОК ============
app.get('/api/market/offers', async (req, res) => {
    try {
        const offers = await market.find({}).sort({ createdAt: -1 }).toArray();
        res.json(offers);
    } catch (err) {
        console.error('Ошибка /api/market/offers:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/market/sell', async (req, res) => {
    const { seller, skin, price } = req.body;
    
    if (!hasAllFields(req.body, ['seller', 'skin', 'price'])) {
        return res.status(400).json({ error: 'Не все данные указаны' });
    }
    if (!isValidNickname(seller)) {
        return res.status(400).json({ error: 'Некорректный ник продавца' });
    }
    if (!isValidSkin(skin)) {
        return res.status(400).json({ error: 'Некорректное название скина' });
    }
    if (!isValidPrice(price)) {
        return res.status(400).json({ error: 'Цена должна быть положительным числом' });
    }
    
    try {
        const sellerExists = await players.findOne({ nickname: seller });
        if (!sellerExists) {
            return res.status(404).json({ error: 'Продавец не найден' });
        }
        
        await market.insertOne({ seller, skin: skin.trim(), price, createdAt: new Date() });
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка /api/market/sell:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/market/buy', async (req, res) => {
    const { buyer, offerId } = req.body;
    
    if (!hasAllFields(req.body, ['buyer', 'offerId'])) {
        return res.status(400).json({ error: 'Не все данные указаны' });
    }
    if (!isValidNickname(buyer)) {
        return res.status(400).json({ error: 'Некорректный ник покупателя' });
    }
    if (!isValidObjectId(offerId)) {
        return res.status(400).json({ error: 'Некорректный ID объявления' });
    }
    
    try {
        const buyerData = await players.findOne({ nickname: buyer });
        if (!buyerData) {
            return res.status(404).json({ error: 'Покупатель не найден' });
        }
        
        const offer = await market.findOneAndDelete({ _id: new ObjectId(offerId) });
        if (!offer) {
            return res.status(404).json({ error: 'Объявление не найдено или уже куплено' });
        }
        
        if (offer.seller === buyer) {
            await market.insertOne(offer);
            return res.status(400).json({ error: 'Нельзя купить собственный предмет' });
        }
        
        if (buyerData.coins < offer.price) {
            await market.insertOne(offer);
            return res.status(400).json({ error: 'Недостаточно золота' });
        }
        
        await players.updateOne({ nickname: buyer }, { $inc: { coins: -offer.price } });
        await players.updateOne({ nickname: offer.seller }, { $inc: { coins: offer.price } });
        
        res.json({ success: true, skin: offer.skin });
    } catch (err) {
        console.error('Ошибка /api/market/buy:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============ ДРУЗЬЯ ============
app.post('/api/friends/request', async (req, res) => {
    const { from, to } = req.body;
    
    if (!hasAllFields(req.body, ['from', 'to'])) {
        return res.status(400).json({ error: 'Не все данные указаны' });
    }
    if (from === to) {
        return res.status(400).json({ error: 'Нельзя добавить самого себя' });
    }
    if (!isValidNickname(from) || !isValidNickname(to)) {
        return res.status(400).json({ error: 'Некорректный никнейм' });
    }
    
    try {
        const [fromPlayer, toPlayer] = await Promise.all([
            players.findOne({ nickname: from }),
            players.findOne({ nickname: to })
        ]);
        
        if (!fromPlayer || !toPlayer) {
            return res.status(404).json({ error: 'Игрок не найден' });
        }
        
        const existing = await friends.findOne({
            $or: [
                { from, to },
                { from: to, to: from }
            ]
        });
        
        if (existing) {
            if (existing.accepted) {
                return res.status(400).json({ error: 'Вы уже друзья' });
            }
            return res.status(400).json({ error: 'Запрос уже отправлен' });
        }
        
        await friends.insertOne({ from, to, accepted: false, createdAt: new Date() });
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка /api/friends/request:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/friends/accept', async (req, res) => {
    const { nickname, requestId } = req.body;
    
    if (!hasAllFields(req.body, ['nickname', 'requestId'])) {
        return res.status(400).json({ error: 'Не все данные указаны' });
    }
    if (!isValidNickname(nickname)) {
        return res.status(400).json({ error: 'Некорректный никнейм' });
    }
    if (!isValidObjectId(requestId)) {
        return res.status(400).json({ error: 'Некорректный ID запроса' });
    }
    
    try {
        const result = await friends.findOneAndUpdate(
            { _id: new ObjectId(requestId), to: nickname, accepted: false },
            { $set: { accepted: true } }
        );
        
        if (!result) {
            return res.status(404).json({ error: 'Запрос не найден' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка /api/friends/accept:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/friends/requests/:nickname', async (req, res) => {
    const { nickname } = req.params;
    if (!isValidNickname(nickname)) {
        return res.status(400).json({ error: 'Некорректный никнейм' });
    }
    
    try {
        const requests = await friends.find({ to: nickname, accepted: false }).toArray();
        res.json(requests);
    } catch (err) {
        console.error('Ошибка /api/friends/requests:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/friends/list/:nickname', async (req, res) => {
    const { nickname } = req.params;
    if (!isValidNickname(nickname)) {
        return res.status(400).json({ error: 'Некорректный никнейм' });
    }
    
    try {
        const friendDocs = await friends.find({
            $or: [{ from: nickname, accepted: true }, { to: nickname, accepted: true }]
        }).toArray();
        
        const friendNames = friendDocs.map(f => f.from === nickname ? f.to : f.from);
        const friendList = await players.find(
            { nickname: { $in: friendNames } },
            { projection: { nickname: 1, kills: 1 } }
        ).toArray();
        res.json(friendList);
    } catch (err) {
        console.error('Ошибка /api/friends/list:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============ GRACEFUL SHUTDOWN ============
async function gracefulShutdown(signal) {
    console.log(`🛑 ${signal} получен, закрываем соединения...`);
    if (client) await client.close();
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============ ОБРАБОТЧИКИ НЕОБРАБОТАННЫХ ОШИБОК ============
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ UNHANDLED REJECTION:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ UNCAUGHT EXCEPTION:', error);
});

// ============ ЗАПУСК ============
connectToMongo().then(() => {
    app.listen(port, () => {
        console.log(`🚀 Сервер запущен на порту ${port}`);
        console.log(`🔐 API_KEY: ${API_KEY.substring(0, 10)}...`);
    });
});