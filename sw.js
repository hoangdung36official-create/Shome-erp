// Trình chạy ngầm tối giản để vượt qua bài kiểm duyệt PWA của Trình duyệt
self.addEventListener('install', (e) => {
    console.log('[Trình chạy ngầm] Đã cài đặt thành công');
});

self.addEventListener('fetch', (e) => {
    // Để trống - cho phép hệ thống gọi API mạng bình thường
});