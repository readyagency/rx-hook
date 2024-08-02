const express = require('express');
const axios = require('axios');
const path = require('path');
const sql = require('mssql');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// Cấu hình để phục vụ các tệp tĩnh (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// Middleware để phân tích JSON trong body của yêu cầu
app.use(express.json());

// Cấu hình Database MSSQL
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    options: {
        encrypt: true,  //Sử dụng mã hoá dữ liệu
        trustServerCertificate: true,  // Bỏ qua xác thực SSL
        enableArithAbort: true  // Dừng truy vấn ngay lập tức khi gặp lỗi và trả về lỗi cho ứng dụng
    },
    port: parseInt(process.env.DB_PORT, 10),
    requestTimeout: 30000  // Tăng thời gian chờ lên 30 giây
};

// Middleware để kiểm tra API key
function checkApiKey(req, res, next) {
    const apiKey = req.query.apikey || req.headers['x-api-key'];
    if (apiKey === process.env.API_KEY) {
        next();
    } else {
        res.status(401).send({ error: 'Unauthorized: Invalid API key' });
    }
};

// Route chính
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route về trang Conference
app.get('/conference', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'conference', 'index.html'));
});

// Route về trang Qrcode
app.get('/qrcode', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'qrcode', 'index.html'));
});

// Route về trang Vip
app.get('/vip', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'vip', 'index.html'));
});

// Route check Vip
app.post('/vip-check', async (req, res) => {
    const { EmperiaCode } = req.body;

    const payload = {
        "EmperiaCode": EmperiaCode,
        "Type": "VIP"
    };

    try {
        const response = await axios.post('https://www.zohoapis.com/creator/custom/tsxcorp/returnBarcode?publickey=4a8kgms41COT7Z5vaphd1XjFk', payload, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const receivedData = response.data;

        // Trả về dữ liệu nhận được từ API
        res.json({
            message: 'Data Success',
            data: receivedData
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            message: 'Data Fail',
            error: error.toString()
        });
    }
});

// Route check Conference
app.post('/cof-check', async (req, res) => {
    const { EmperiaCode } = req.body;

    const payload = {
        "EmperiaCode": EmperiaCode,
        "Type": "COF"
    };

    try {
        const response = await axios.post('https://www.zohoapis.com/creator/custom/tsxcorp/returnBarcode?publickey=4a8kgms41COT7Z5vaphd1XjFk', payload, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const receivedData = response.data;

        // Trả về dữ liệu nhận được từ API
        res.json({
            message: 'Data Success',
            data: receivedData
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            message: 'Data Fail',
            error: error.toString()
        });
    }
});

// Hàm kiểm tra và xử lý dữ liệu mới
async function checkForNewData() {
    // Lấy thời gian hiện tại
    const now = new Date();

    // Tính toán thời gian UTC+7
    const utcPlus7 = new Date(now.getTime() + 7 * 60 * 60 * 1000);

    try {
        const pool = await sql.connect(dbConfig);

        // Truy vấn dữ liệu chưa được xử lý
        const result = await pool.request().query('SELECT TOP 1 USERID, CHECKTIME FROM CheckInOutQueue WHERE Processed = 0 ORDER BY CHECKTIME DESC');

        if (result.recordset.length > 0) {
            const { USERID, CHECKTIME } = result.recordset[0];

            // Gửi dữ liệu tới API Zoho
            await sendDataToAPI(USERID, CHECKTIME);

            // Cập nhật trạng thái của bản ghi đã được xử lý
            await pool.request()
                .input('userId', sql.Int, USERID)
                .input('checkTime', sql.DateTime, CHECKTIME)
                .query(`UPDATE CheckInOutQueue SET Processed = 1 WHERE USERID = @userId AND CHECKTIME = @checkTime`);

            // Đóng kết nối cơ sở dữ liệu
            await sql.close();
        }

    } catch (err) {
        console.error(utcPlus7.toISOString(), '- Lỗi kết nối tới DB:', err);
    }
};

// Hàm xử lý gửi dữ liệu tới API
async function sendDataToAPI(userId, checkTime) {
    const now = new Date();

    // Tính toán thời gian UTC+7
    const utcPlus7 = new Date(now.getTime() + 7 * 60 * 60 * 1000);

    try {
        // Kết nối đến database
        const pool = await sql.connect(dbConfig);

        // Truy vấn dữ liệu từ bảng USERINFO và CHECKINOUT
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .input('checkTime', sql.DateTime, checkTime)
            .query(`
                SELECT u.CardNo, c.CHECKTIME
                FROM USERINFO u
                INNER JOIN CHECKINOUT c ON u.USERID = c.USERID
                WHERE u.USERID = @userId AND c.CHECKTIME = @checkTime
            `);

        if (result.recordset.length > 0) {
            const data = result.recordset[0];
            console.log(utcPlus7.toISOString(), '- VIP', data.CardNo, 'đã CHECK-IN');

            const response = await axios.post(`${process.env.API_URL}?publickey=${process.env.API_KEY}`, {
                user: data.CardNo,
                time: data.CHECKTIME,
                tf: "I"
            });
            if (response.data.code === 3000) {
                console.log(utcPlus7.toISOString(), '- Đã lưu CHECK-IN của VIP', data.CardNo, 'vào Zoho');
            } else {
                console.error(utcPlus7.toISOString(), '- Lỗi gửi CHECK-IN của VIP tới Zoho:', response.data.code);
            }
        } else {
            console.log('Không tìm thấy dữ liệu để gửi.');
        }

    } catch (error) {
        console.error(utcPlus7.toISOString(), '- Lỗi khi gửi dữ liệu:', error);
    }
};

// Thiết lập kiểm tra dữ liệu mới mỗi 5 giây
setInterval(checkForNewData, 5000);


// Thêm VIP mới
app.post('/assign-vip', checkApiKey, async (req, res) => {
    // Lấy thời gian hiện tại
    const now = new Date();

    // Tính toán thời gian UTC+7
    const utcPlus7 = new Date(now.getTime() + 7 * 60 * 60 * 1000);

    const userId = req.body.user;

    if (!userId) {
        return res.status(400).send({ error: 'User ID is required' });
    }

    try {
        // Kết nối tới cơ sở dữ liệu
        const pool = await sql.connect(dbConfig);

        // Bắt đầu một giao dịch
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Truy vấn để lưu dữ liệu và lấy USERID vừa tạo
            const request = new sql.Request(transaction);
            const insertResult = await request
                .query(`
                    INSERT INTO USERINFO (Badgenumber, CardNo, SSN, AccGroup, morecard_group_id, hiretype, emptype)
                    OUTPUT INSERTED.USERID
                    VALUES (${userId}, ${userId}, 0, 0, 0, 0, 0)
                `);

            const newUserId = insertResult.recordset[0].USERID;

            // Chèn USERID vào bảng acc_levelset_emp
            await request
                .query(`
                    INSERT INTO acc_levelset_emp (acclevelset_id, employee_id)
                    VALUES (1, ${newUserId})
                `);

            // Commit giao dịch
            await transaction.commit();

            res.status(200).send({ message: 'User has been assigned as VIP', newUserId });
            console.log(utcPlus7.toISOString(), '-', userId, 'has been assigned as VIP');
        } catch (err) {
            // Rollback giao dịch nếu có lỗi
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(utcPlus7.toISOString(), 'SQL error', err);
        res.status(500).send({ error: 'Internal server error' });
    } finally {
        // Đóng kết nối cơ sở dữ liệu
        await sql.close();
    }
});

// Xoá VIP sau khi đã check in
app.post('/delete-vip', checkApiKey, async (req, res) => {
    // Lấy thời gian hiện tại
    const now = new Date();

    // Tính toán thời gian UTC+7
    const utcPlus7 = new Date(now.getTime() + 7 * 60 * 60 * 1000);

    const userId = req.body.user;

    if (!userId) {
        return res.status(400).send({ error: 'User ID is required' });
    }

    try {
        // Kết nối tới cơ sở dữ liệu
        await sql.connect(dbConfig);

        // Truy vấn để lưu dữ liệu
        const result = await sql.query`DELETE FROM USERINFO WHERE Badgenumber = ${userId};`;

        res.status(200).send({ message: 'User has been deleted', result });
        console.log(utcPlus7.toISOString(), '- VIP', userId, 'đã hết số lần vào VIP lounge',);
    } catch (err) {
        console.error(utcPlus7.toISOString(), 'SQL error', err);
        res.status(500).send({ error: 'Internal server error' });
    } finally {
        // Đóng kết nối cơ sở dữ liệu
        await sql.close();
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    try {
        // Kết nối tới cơ sở dữ liệu
        sql.connect(dbConfig);
        console.log('Connect DB Success');
    } catch (err) {
        console.error('SQL error', err);
        res.status(500).send({ error: 'MSSQL server error' });
    }
});