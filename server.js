require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());
const path = require('path');
app.use(express.static(__dirname)); 
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'app.html'));
});

// 1. CẤU HÌNH KẾT NỐI CƠ SỞ DỮ LIỆU ĐA TẦNG (ÉP BUỘC IPV4 ĐỂ TRÁNH NGHẼN MẠNG)
mongoose.connect(process.env.MONGO_URI, { family: 4 })
    .then(() => {
        console.log('=== HỆ THỐNG ĐÃ KẾT NỐI DATABASE MONGODB THÀNH CÔNG ===');
        khoiTaoHeThongGoc(); 
    })
    .catch((err) => console.error('LỖI KẾT NỐI DATABASE TRUNG TÂM:', err));

// 2. ĐỊNH NGHĨA KHUÔN MẪU DỮ LIỆU CHUẨN ĐỒNG BỘ (SCHEMAS)
const taiKhoanSchema = new mongoose.Schema({
    tai_khoan: { type: String, unique: true, required: true },
    mat_khau: { type: String, required: true },
    vai_tro: { type: String, required: true }, // 'Quản Trị Viên', 'Giám Sát Hiện Trường', 'Kế Toán'
    cong_trinh_phu_trach: [String],
    trang_thai: { type: String, default: 'Hoạt động' }
});
const TaiKhoan = mongoose.model('TaiKhoan', taiKhoanSchema);

const vatTuSchema = new mongoose.Schema({
    ngay_nhap: { type: String, required: true },
    ten_cong_trinh: { type: String, required: true },
    ten_vat_tu: { type: String, required: true }, 
    so_luong: { type: Number, required: true }, 
    don_vi: { type: String, default: 'Đơn vị' }, 
    ghi_chu: { type: String, default: '' },
    nguoi_tao: { type: String, required: true }, 
    thoi_gian_tao: { type: Date, default: Date.now }
});
const VatTu = mongoose.model('VatTu', vatTuSchema);

const danhMucSchema = new mongoose.Schema({ 
    loai: { type: String, required: true }, // 'CongTrinh' hoặc 'VatTu'
    ten: { type: String, required: true, unique: true } 
});
const DanhMuc = mongoose.model('DanhMuc', danhMucSchema);

const nhatKySchema = new mongoose.Schema({
    nguoi_thuc_hien: { type: String, required: true },
    hanh_dong: { type: String, required: true },
    chi_tiet: { type: String, required: true },
    thoi_gian: { type: Date, default: Date.now }
});
const NhatKy = mongoose.model('NhatKy', nhatKySchema);

// AUTO-SEEDING: KHỞI TẠO TÀI KHOẢN GỐC VÀ CÁC CƠ SỞ DỮ LIỆU MẪU
async function khoiTaoHeThongGoc() {
    try {
        // Khởi tạo tài khoản quản trị tối cao
        const adminCoSan = await TaiKhoan.findOne({ tai_khoan: 'quantri' });
        if (!adminCoSan) {
            const matKhauMaHoa = await bcrypt.hash('123456', 10);
            await new TaiKhoan({ 
                tai_khoan: 'quantri', 
                mat_khau: matKhauMaHoa, 
                vai_tro: 'Quản Trị Viên',
                cong_trinh_phu_trach: [] 
            }).save();
            console.log('-> ĐÃ KHỞI TẠO TÀI KHOẢN MẪU CAO CẤP: [quantri] | MẬT KHẨU: [123456]');
        }

        // Khởi tạo danh mục công trình lõi
        const congTrinhMau = ['29S.HOME', 'VINCENT HOUSE', 'Tòa nhà Hà Đông', 'Cơ sở Ngọc Trục'];
        for (const ct of congTrinhMau) {
            const tonTai = await DanhMuc.findOne({ loai: 'CongTrinh', ten: ct });
            if (!tonTai) await new DanhMuc({ loai: 'CongTrinh', ten: ct }).save();
        }

        // Khởi tạo danh mục vật tư tiêu chuẩn
        const vatTuMau = ['Xi măng', 'Gạch thẻ', 'Cát đá', 'Thép Phi 10', 'Sơn nội thất', 'Công tơ điện'];
        for (const vt of vatTuMau) {
            const tonTai = await DanhMuc.findOne({ loai: 'VatTu', ten: vt });
            if (!tonTai) await new DanhMuc({ loai: 'VatTu', ten: vt }).save();
        }
    } catch (e) {
        console.error('Lỗi khởi tạo hệ thống mẫu:', e);
    }
}

// 3. XỬ LÝ ĐĂNG NHẬP BẢO MẬT (CHÌA KHÓA MÃ HÓA TOÀN VẸN)
const CHUOI_BAO_MAT = 'ERP_FUTURE_CORE_TOKEN_KEY_2026_SYSTEM';

app.post('/api/dang-nhap', async (req, res) => {
    try {
        const { tai_khoan, mat_khau } = req.body;
        console.log(`Yêu cầu đăng nhập từ tài khoản: ${tai_khoan}`);
        
        const user = await TaiKhoan.findOne({ tai_khoan });
        if (!user) {
            return res.status(401).json({ error: "Tài khoản không tồn tại trên hệ thống!" });
        }
        if (user.trang_thai === 'Đã nghỉ việc') {
            return res.status(403).json({ error: "Tài khoản đã bị khóa (Do đã nghỉ việc)!" });
        }
        
        const hopLe = await bcrypt.compare(mat_khau, user.mat_khau);
        if (!hopLe) {
            return res.status(401).json({ error: "Mật khẩu truy cập không chính xác!" });
        }
        
        const token = jwt.sign({ id: user._id, vai_tro: user.vai_tro }, CHUOI_BAO_MAT, { expiresIn: '24h' });
        
        await new NhatKy({ 
            nguoi_thuc_hien: user.tai_khoan, 
            hanh_dong: 'Đăng nhập', 
            chi_tiet: 'Truy cập vào hệ thống điều hành' 
        }).save();
        
        res.json({ 
            thành_công: true,
            token, 
            vai_tro: user.vai_tro, 
            tai_khoan: user.tai_khoan,
            cong_trinh: user.cong_trinh_phu_trach
        });
    } catch (err) {
        console.error("Lỗi xử lý đăng nhập phía Backend:", err);
        res.status(500).json({ error: "Lỗi hệ thống máy chủ xử lý dữ liệu!" });
    }
});

// 4. BỘ PHÂN TÍCH GIỌNG NÓI AI (NÂNG CẤP XỬ LÝ NHIỀU MỤC CÙNG LÚC)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/api/xuly-giongnoi', async (req, res) => {
    try {
        const dsCT = await DanhMuc.find({ loai: 'CongTrinh' });
        const dsVT = await DanhMuc.find({ loai: 'VatTu' });
        const danhSachGocCongTrinh = dsCT.map(d => d.ten).join(', ');
        const danhSachGocVatTu = dsVT.map(d => d.ten).join(', ');
        
        const ngayHienTai = new Date().toISOString().split('T')[0];
        
        const prompt = `Bạn là trợ lý ảo ERP vận hành chuỗi tòa nhà. Hôm nay là ngày ${ngayHienTai}.
        Nhiệm vụ: Phân tích lệnh giọng nói và trích xuất thành MỘT MẢNG JSON (JSON Array) chứa DANH SÁCH các vật tư.
        Quy tắc:
        1. "ten_cong_trinh": Chọn trong: [${danhSachGocCongTrinh}].
        2. "ten_vat_tu": Chọn trong: [${danhSachGocVatTu}]. Nếu người dùng nói nhiều vật tư khác nhau, hãy tách ra thành nhiều mục.
        3. "ngay_nhap": YYYY-MM-DD. Nếu nói "hôm nay", điền ${ngayHienTai}.
        4. "so_luong": Chỉ lấy giá trị số. Nếu nói "1,8 tấn" thì so_luong là 1.8, don_vi là "tấn".
        
        Cấu trúc JSON đầu ra bắt buộc phải là một MẢNG (dù chỉ có 1 mục):
        [
            {
                "ngay_nhap": "YYYY-MM-DD",
                "ten_cong_trinh": "Tên công trình",
                "ten_vat_tu": "Tên vật tư 1",
                "so_luong": số,
                "don_vi": "Tên đơn vị",
                "ghi_chu": "Ghi chú nếu có"
            },
            {
                "ngay_nhap": "YYYY-MM-DD",
                "ten_cong_trinh": "Tên công trình",
                "ten_vat_tu": "Tên vật tư 2",
                "so_luong": số,
                "don_vi": "Tên đơn vị",
                "ghi_chu": "Ghi chú nếu có"
            }
        ]
        Chỉ trả về chuỗi JSON Array duy nhất.
        Văn bản: "${req.body.text}"`;

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);
        const textResponse = result.response.text();
        const jsonMatch = textResponse.match(/\[[\s\S]*\]/); // Tìm dấu ngoặc vuông của Mảng
        
        if (!jsonMatch) return res.status(400).json({ error: "AI không thể định dạng cấu trúc!" });
        res.json({ du_lieu_ai: JSON.parse(jsonMatch[0]) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Xử lý giọng nói AI gặp gián đoạn!" });
    }
});

// 5. CÁC ĐƯỜNG DẪN API (ENDPOINTS) ĐỒNG BỘ TOÀN DIỆN
app.post('/api/luu-vat-tu', async (req, res) => {
    try {
        const { danh_sach_phieu, nguoi_tao } = req.body;
        
        if(!danh_sach_phieu || !danh_sach_phieu.length) {
            return res.status(400).json({ error: "Không có dữ liệu để lưu" });
        }

        // Gắn thông tin người tạo và thời gian vào từng dòng
        const duLieuSanhSang = danh_sach_phieu.map(item => ({
            ...item,
            nguoi_tao: nguoi_tao
        }));

        // Lưu hàng loạt (Bulk Insert) vào Database
        await VatTu.insertMany(duLieuSanhSang);

        // Ghi nhật ký tổng hợp
        const tenCongTrinhChung = duLieuSanhSang[0].ten_cong_trinh || "hệ thống";
        await new NhatKy({
            nguoi_thuc_hien: nguoi_tao,
            hanh_dong: 'Nhập lô vật tư',
            chi_tiet: `Ghi nhận 1 lô gồm ${duLieuSanhSang.length} loại vật tư/hạng mục tại ${tenCongTrinhChung}`
        }).save();

        res.json({ status: "Thành công" });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: "Lỗi lưu dữ liệu" }); 
    }
});

app.get('/api/vat-tu', async (req, res) => {
    const list = await VatTu.find().sort({ ngay_nhap: -1, thoi_gian_tao: -1 });
    res.json(list);
});

app.get('/api/danh-muc', async (req, res) => res.json(await DanhMuc.find()));

app.post('/api/danh-muc', async (req, res) => {
    try {
        const { loai, ten, nguoi_tao } = req.body;
        const trung = await DanhMuc.findOne({ loai, ten });
        if (trung) return res.status(400).json({ error: "Hạng mục danh mục này đã có sẵn!" });
        
        await new DanhMuc({ loai, ten }).save();
        await new NhatKy({ nguoi_thuc_hien: nguoi_tao, hanh_dong: 'Thêm danh mục', chi_tiet: `Tạo mới hạng mục ${loai}: ${ten}` }).save();
        res.json({ status: "Thành công" });
    } catch (e) { res.status(500).json({ error: "Lỗi hệ thống" }); }
});

app.post('/api/xoa-danh-muc', async (req, res) => {
    try {
        const { id, ten, nguoi_xoa } = req.body;
        await DanhMuc.findByIdAndDelete(id);
        await new NhatKy({ nguoi_thuc_hien: nguoi_xoa, hanh_dong: 'Xóa danh mục', chi_tiet: `Loại bỏ hạng mục khỏi hệ thống: ${ten}` }).save();
        res.json({ status: "Thành công" });
    } catch (e) { res.status(500).json({ error: "Lỗi thực thi xóa" }); }
});

app.get('/api/nguoi-dung', async (req, res) => res.json(await TaiKhoan.find({}, '-mat_khau')));

app.post('/api/nguoi-dung', async (req, res) => {
    try {
        const { tai_khoan, mat_khau, vai_tro, cong_trinh, nguoi_tao } = req.body;
        const tonTai = await TaiKhoan.findOne({ tai_khoan });
        if (tonTai) return res.status(400).json({ error: "Tên tài khoản này đã được đăng ký!" });
        
        const bămMậtKhẩu = await bcrypt.hash(mat_khau, 10);
        await new TaiKhoan({ tai_khoan, mat_khau: bămMậtKhẩu, vai_tro, cong_trinh_phu_trach: cong_trinh }).save();
        await new NhatKy({ nguoi_thuc_hien: nguoi_tao, hanh_dong: 'Tạo nhân sự', chi_tiet: `Cấp tài khoản mới cho [${tai_khoan}] vai trò [${vai_tro}]` }).save();
        res.json({ status: "Thành công" });
    } catch (e) { res.status(500).json({ error: "Lỗi tạo tài khoản" }); }
});

app.get('/api/nhat-ky', async (req, res) => res.json(await NhatKy.find().sort({ thoi_gian: -1 }).limit(100)));

// --- BỘ API QUẢN TRỊ NGƯỜI DÙNG NÂNG CAO ---

// 1. Cấp lại mật khẩu mới (Đã tích hợp mã hóa Bcrypt)
app.put('/api/nguoi-dung/mat-khau', async (req, res) => {
    try {
        const matKhauMaHoa = await bcrypt.hash(req.body.mat_khau_moi, 10);
        await TaiKhoan.updateOne({ tai_khoan: req.body.tai_khoan }, { mat_khau: matKhauMaHoa });
        await new NhatKy({ nguoi_thuc_hien: req.body.nguoi_thuc_hien, hanh_dong: 'Cấp lại Mật khẩu', chi_tiet: `Thay đổi mật khẩu cho nhân sự: ${req.body.tai_khoan}` }).save();
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// 2. Thay đổi trạng thái làm việc (Khóa/Mở tài khoản)
app.put('/api/nguoi-dung/trang-thai', async (req, res) => {
    try {
        await TaiKhoan.updateOne({ tai_khoan: req.body.tai_khoan }, { trang_thai: req.body.trang_thai });
        await new NhatKy({ nguoi_thuc_hien: req.body.nguoi_thuc_hien, hanh_dong: 'Đổi Trạng thái', chi_tiet: `Chuyển tài khoản ${req.body.tai_khoan} sang trạng thái: ${req.body.trang_thai}` }).save();
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// 3. Xóa vĩnh viễn nhân sự
app.delete('/api/nguoi-dung/:taikhoan', async (req, res) => {
    try {
        await TaiKhoan.deleteOne({ tai_khoan: req.params.taikhoan });
        await new NhatKy({ nguoi_thuc_hien: req.query.nguoi_thuc_hien, hanh_dong: 'Xóa Nhân sự', chi_tiet: `Xóa vĩnh viễn hệ thống tài khoản: ${req.params.taikhoan}` }).save();
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// KÍCH HOẠT CỔNG MÁY CHỦ TRUNG TÂM
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`=== MÁY CHỦ CLOUD KHỞI CHẠY THÀNH CÔNG ===`);
});