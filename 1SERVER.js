const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error('❌ MONGODB_URI не задана!');
    process.exit(1);
}

let db;
let players;
let market;
let friends;

async function connectToMongo() {
    try {
        const client = new MongoClient(uri);
        await client.connect();
        db = client.db('cso_ultimate');
        players = db.collection('players');
        market = db.collection('market');
        friends = db.collection('friends');
        
        await players.createIndex({ nickname: 1 }, { unique: true });
        console.log('✅ Подключено к MongoDB');
    } catch (err) {
        console.error('❌ Ошибка подключения:', err);
        process.exit(1);
    }
}

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
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============ ОБНОВЛЕНИЕ ИГРОКА ============
app.post('/api/player', async (req, res) => {
    const { nickname, kills, coins, level } = req.body;
    if (!nickname) return res.status(400).json({ error: 'Nickname обязателен' });
    try {
        await players.updateOne(
            { nickname },
            { $set: { kills, coins, level, lastUpdated: new Date() } },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============ РЫНОК: ПОЛУЧИТЬ ОБЪЯВЛЕНИЯ ============
app.get('/api/market/offers', async (req, res) => {
    try {
        const offers = await market.find({}).sort({ createdAt: -1 }).toArray();
        res.json(offers);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============ РЫНОК: ВЫСТАВИТЬ НА ПРОДАЖУ ============
app.post('/api/market/sell', async (req, res) => {
    const { seller, skin, price } = req.body;
    if (!seller || !skin || !price) {
        return res.status(400).json({ error: 'Не все данные указаны' });
    }
    if (price <= 0) {
        return res.status(400).json({ error: 'Цена должна быть больше 0' });
    }
    try {
        await market.insertOne({ seller, skin, price, createdAt: new Date() });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============ РЫНОК: КУПИТЬ ============
app.post('/api/market/buy', async (req, res) => {
    const { buyer, offerId } = req.body;
    if (!buyer || !offerId) {
        return res.status(400).json({ error: 'Не все данные указаны' });
    }
    try {
        const offer = await market.findOne({ _id: new ObjectId(offerId) });
        if (!offer) {
            return res.status(404).json({ error: 'Объявление не найдено' });
        }
        
        const buyerData = await players.findOne({ nickname: buyer });
        if (!buyerData || buyerData.coins < offer.price) {
            return res.status(400).json({ error: 'Недостаточно золота' });
        }
        
        await players.updateOne({ nickname: buyer }, { $inc: { coins: -offer.price } });
        await players.updateOne({ nickname: offer.seller }, { $inc: { coins: offer.price } });
        await market.deleteOne({ _id: offer._id });
        
        res.json({ success: true, skin: offer.skin });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============ ДРУЗЬЯ: ОТПРАВИТЬ ЗАПРОС ============
app.post('/api/friends/request', async (req, res) => {
    const { from, to } = req.body;
    if (!from || !to || from === to) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }
    try {
        const existing = await friends.findOne({ from, to });
        if (existing) {
            return res.status(400).json({ error: 'Запрос уже отправлен' });
        }
        await friends.insertOne({ from, to, accepted: false, createdAt: new Date() });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============ ДРУЗЬЯ: ПРИНЯТЬ ЗАПРОС ============
app.post('/api/friends/accept', async (req, res) => {
    const { nickname, requestId } = req.body;
    if (!nickname || !requestId) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }
    try {
        const request = await friends.findOne({ _id: new ObjectId(requestId), to: nickname, accepted: false });
        if (!request) {
            return res.status(404).json({ error: 'Запрос не найден' });
        }
        await friends.updateOne({ _id: request._id }, { $set: { accepted: true } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============ ДРУЗЬЯ: ВХОДЯЩИЕ ЗАПРОСЫ ============
app.get('/api/friends/requests/:nickname', async (req, res) => {
    const { nickname } = req.params;
    try {
        const requests = await friends.find({ to: nickname, accepted: false }).toArray();
        res.json(requests);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============ ДРУЗЬЯ: СПИСОК ДРУЗЕЙ ============
app.get('/api/friends/list/:nickname', async (req, res) => {
    const { nickname } = req.params;
    try {
        const friendDocs = await friends.find({
            $or: [{ from: nickname, accepted: true }, { to: nickname, accepted: true }]
        }).toArray();
        
        const friendNames = friendDocs.map(f => f.from === nickname ? f.to : f.from);
        const friendList = await players.find({ nickname: { $in: friendNames } }, { projection: { nickname: 1, kills: 1 } }).toArray();
        res.json(friendList);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

connectToMongo().then(() => {
    app.listen(port, () => {
        console.log(`🚀 Сервер запущен на порту ${port}`);
    });
});
