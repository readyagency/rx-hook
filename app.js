const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const sql = require('mssql');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

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
    port: parseInt(process.env.DB_PORT, 10)
};

// Middleware để kiểm tra API key
function checkApiKey(req, res, next) {
    const apiKey = req.query.apikey || req.headers['x-api-key'];
    if (apiKey === process.env.API_KEY) {
        next();
    } else {
        res.status(401).send({ error: 'Unauthorized: Invalid API key' });
    }
}

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

            // Gửi dữ liệu tới API
            await sendDataToAPI(USERID, CHECKTIME);
            console.log('Data Check in', USERID, CHECKTIME);

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
}

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
            console.log('Data sẽ xoá', data);

            const response = await axios.post(`${process.env.API_URL}?publickey=${process.env.API_KEY}`, {
                user: data.CardNo,
                time: data.CHECKTIME,
                tf: "I"
            });
            console.log(utcPlus7.toISOString(), '- Lệnh delete đã gửi tới Zoho:', response.data);
        } else {
            console.log('Không tìm thấy dữ liệu để gửi.');
        }

    } catch (error) {
        console.error(utcPlus7.toISOString(), '- Lỗi khi gửi dữ liệu:', error);
    }
}

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
        console.log(utcPlus7.toISOString(), '-', userId, 'has been DELETED',);
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