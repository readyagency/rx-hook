document.getElementById('vipForm').addEventListener('submit', function(event) {
    event.preventDefault(); // Ngăn không cho form submit mặc định

    // Lấy giá trị từ ô input
    const inputData = document.getElementById('inputData').value;

    // Tạo payload để gửi đến API
    const payload = {
        "EmperiaCode": inputData
    };

    console.log(payload)

    // Gửi dữ liệu đến API
    fetch('/vip-check', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
        // Hiện trạng thái data
        document.getElementById('checkErr').textContent = '<----------- Data Success ----------->';

        // Mở link với dữ liệu nhận được từ API
        const receivedData = data.data.result;
        const popup = window.open (`../qrcode/?text=${receivedData}`, '_blank', 'width=600,height=400');

        // Tự động đóng cửa sổ popup sau 1 giây
        setTimeout(() => {
            popup.close();
        }, 1000);

        // Xóa dữ liệu trong ô input
        document.getElementById('inputData').value = '';
    })
    .catch((error) => {
        // Hiện trạng thái data
        document.getElementById('checkErr').textContent = '<----------- Data Fail ----------->';
        console.error('Error:', error);

        // Xóa dữ liệu trong ô input
        document.getElementById('inputData').value = '';
    });
});