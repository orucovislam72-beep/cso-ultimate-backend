const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Получаем строку подключения из переменной окружения
const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error('❌ MONGODB_URI не задана!');
    process.exit(1);
}

let db;
let playersCollection;

// Подключение к MongoDB
async function connectToMongo() {
    try {
        const client = new MongoClient(uri);
        await client.connect();
        db = client.db('cso_ultimate');
        playersCollection = db.collection('players');
        console.log('✅ Подключено к MongoDB');
        
        // Создаём уникальный индекс по нику
        await playersCollection.createIndex({ nickname: 1 }, { unique: true });
    } catch (err) {
        console.error('❌ Ошибка подключения к MongoDB:', err);
        process.exit(1);
    }
}

// API: получить топ-10 игроков по убийствам
app.get('/api/top', async (req, res) => {
    try {
        const topPlayers = await playersCollection
            .find({}, { projection: { nickname: 1, kills: 1, coins: 1, level: 1 } })
            .sort({ kills: -1 })
            .limit(10)
            .toArray();
        res.json(topPlayers);
    } catch (err) {
        console.error('Ошибка при получении топа:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// API: обновить или создать игрока
app.post('/api/player', async (req, res) => {
    const { nickname, kills, coins, level } = req.body;
    if (!nickname) {
        return res.status(400).json({ error: 'Nickname обязателен' });
    }
    try {
        const result = await playersCollection.updateOne(
            { nickname },
            { $set: { kills, coins, level, lastUpdated: new Date() } },
            { upsert: true }
        );
        res.json({ success: true, matchedCount: result.matchedCount });
    } catch (err) {
        console.error('Ошибка при обновлении игрока:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Запуск сервера
connectToMongo().then(() => {
    app.listen(port, () => {
        console.log(`🚀 Сервер запущен на порту ${port}`);
    });
});