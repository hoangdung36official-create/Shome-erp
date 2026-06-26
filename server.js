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

// 1. CẤU HÌNH KẾT NỐI MONGODB
mongoose.connect(process.env.MONGO_URI, { family: 4 })
    .then(() => {
        console.log('=== HỆ THỐNG ĐÃ KẾT NỐI DATABASE MONGODB THÀNH CÔNG ===');
        khoiTaoHeThongGoc(); 
    })
    .catch((err) => console.error('LỖI KẾT NỐI DATABASE TRUNG TÂM:', err));

// 2. KHUÔN MẪU DỮ LIỆU CHUẨN
const taiKhoanSchema = new mongoose.Schema({
    tai_khoan: { type: String, unique: true, required: true },
    mat_khau: { type: String, required: true },
    vai_tro: { type: String, required: true }, 
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
    loai: { type: String, required: true },
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

async function khoiTaoHeThongGoc() {
    try {
        const adminCoSan = await TaiKhoan.findOne({ tai_khoan: 'quantri' });
        if (!adminCoSan) {
            const matKhauMaHoa = await bcrypt.hash('123456', 10);
            await new TaiKhoan({ tai_khoan: 'quantri', mat_khau: matKhauMaHoa, vai_tro: 'Quản Trị Viên', cong_trinh_phu_trach: [] }).save();
            console.log('-> ĐÃ KHỞI TẠO TÀI KHOẢN MẪU CAO CẤP: [quantri] | MẬT KHẨU: [123456]');
        }
        const congTrinhMau = ['29S.HOME', 'VINCENT HOUSE', 'Tòa nhà Hà Đông', 'Cơ sở Ngọc Trục'];
        for (const ct of congTrinhMau) {
            if (!(await DanhMuc.findOne({ loai: 'CongTrinh', ten: ct }))) await new DanhMuc({ loai: 'CongTrinh', ten: ct }).save();
        }
        const vatTuMau = ['Xi măng', 'Gạch thẻ', 'Cát đá', 'Thép Phi 10', 'Sơn nội thất', 'Công tơ điện'];
        for (const vt of vatTuMau) {
            if (!(await DanhMuc.findOne({ loai: 'VatTu', ten: vt }))) await new DanhMuc({ loai: 'VatTu', ten: vt }).save();
        }
    } catch (e) { console.error('Lỗi khởi tạo:', e); }
}

// 3. XỬ LÝ ĐĂNG NHẬP
const CHUOI_BAO_MAT = 'ERP_FUTURE_CORE_TOKEN_KEY_2026_SYSTEM';
app.post('/api/dang-nhap', async (req, res) => {
    try {
        const { tai_khoan, mat_khau } = req.body;
        const user = await TaiKhoan.findOne({ tai_khoan });
        
        if (!user) return res.status(401).json({ error: "Tài khoản không tồn tại trên hệ thống!" });
        if (user.trang_thai === 'Đã nghỉ việc') return res.status(403).json({ error: "Tài khoản đã bị khóa (Do đã nghỉ việc)!" });
        
        const hopLe = await bcrypt.compare(mat_khau, user.mat_khau);
        if (!hopLe) return res.status(401).json({ error: "Mật khẩu truy cập không chính xác!" });
        
        const token = jwt.sign({ id: user._id, vai_tro: user.vai_tro }, CHUOI_BAO_MAT, { expiresIn: '24h' });
        await new NhatKy({ nguoi_thuc_hien: user.tai_khoan, hanh_dong: 'Đăng nhập', chi_tiet: 'Truy cập vào hệ thống điều hành' }).save();
        
        res.json({ thành_công: true, token, vai_tro: user.vai_tro, tai_khoan: user.tai_khoan, cong_trinh: user.cong_trinh_phu_trach });
    } catch (err) { res.status(500).json({ error: "Lỗi máy chủ!" }); }
});

// 4. BỘ NÃO AI BÓC TÁCH GIỌNG NÓI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
app.post('/api/xuly-giongnoi', async (req, res) => {
    try {
        const dsCT = await DanhMuc.find({ loai: 'CongTrinh' });
        const dsVT = await DanhMuc.find({ loai: 'VatTu' });
        const danhSachGocCongTrinh = dsCT.map(d => d.ten).join(', ');
        const danhSachGocVatTu = dsVT.map(d => d.ten).join(', ');
        const ngayHienTai = new Date().toISOString().split('T')[0];
        
        const prompt = `Bạn là trợ lý ảo ERP vận hành chuỗi tòa nhà. Hôm nay là ngày ${ngayHienTai}.
        Nhiệm vụ: Phân tích lệnh giọng nói và trích xuất thành MỘT MẢNG JSON.
        Quy tắc: 1. "ten_cong_trinh" thuộc: [${danhSachGocCongTrinh}]. 2. "ten_vat_tu" thuộc: [${danhSachGocVatTu}]. 3. "ngay_nhap": YYYY-MM-DD. 4. "so_luong": Chỉ lấy giá trị số.
        Cấu trúc JSON MẢNG: [{"ngay_nhap": "YYYY-MM-DD", "ten_cong_trinh": "...", "ten_vat_tu": "...", "so_luong": số, "don_vi": "...", "ghi_chu": "..."}]
        Văn bản: "${req.body.text}"`;

        const result = await genAI.getGenerativeModel({ model: "gemini-2.5-flash" }).generateContent(prompt);
        const jsonMatch = result.response.text().match(/\[[\s\S]*\]/);
        
        if (!jsonMatch) return res.status(400).json({ error: "AI không thể định dạng cấu trúc!" });
        res.json({ du_lieu_ai: JSON.parse(jsonMatch[0]) });
    } catch (e) { res.status(500).json({ error: "Lỗi AI!" }); }
});

// 5. CÁC ĐƯỜNG DẪN API LÕI
app.post('/api/luu-vat-tu', async (req, res) => {
    try {
        const { danh_sach_phieu, nguoi_tao } = req.body;
        if(!danh_sach_phieu || !danh_sach_phieu.length) return res.status(400).json({ error: "Không có dữ liệu" });
        const duLieuSanhSang = danh_sach_phieu.map(item => ({ ...item, nguoi_tao }));
        await VatTu.insertMany(duLieuSanhSang);
        await new NhatKy({ nguoi_thuc_hien: nguoi_tao, hanh_dong: 'Nhập lô vật tư', chi_tiet: `Ghi nhận 1 lô gồm ${duLieuSanhSang.length} loại vật tư` }).save();
        res.json({ status: "Thành công" });
    } catch (e) { res.status(500).json({ error: "Lỗi lưu kho" }); }
});

app.get('/api/vat-tu', async (req, res) => res.json(await VatTu.find().sort({ ngay_nhap: -1, thoi_gian_tao: -1 })));
// Cập nhật (Sửa) phiếu giao dịch
app.put('/api/vat-tu/:id', async (req, res) => {
    try {
        const dataMoi = req.body.du_lieu;
        await VatTu.findByIdAndUpdate(req.params.id, dataMoi);
        await new NhatKy({ nguoi_thuc_hien: req.body.nguoi_thuc_hien, hanh_dong: 'Sửa phiếu', chi_tiet: `Cập nhật số liệu vật tư: ${dataMoi.ten_vat_tu} tại ${dataMoi.ten_cong_trinh}` }).save();
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Xóa vĩnh viễn phiếu giao dịch
app.delete('/api/vat-tu/:id', async (req, res) => {
    try {
        const phieu = await VatTu.findById(req.params.id);
        if(!phieu) return res.status(404).json({error: "Không tìm thấy"});
        await VatTu.findByIdAndDelete(req.params.id);
        await new NhatKy({ nguoi_thuc_hien: req.query.nguoi_thuc_hien, hanh_dong: 'Xóa phiếu', chi_tiet: `Xóa giao dịch vật tư: ${phieu.ten_vat_tu} (${phieu.so_luong} ${phieu.don_vi})` }).save();
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/danh-muc', async (req, res) => res.json(await DanhMuc.find()));

app.post('/api/danh-muc', async (req, res) => {
    try {
        const trung = await DanhMuc.findOne({ loai: req.body.loai, ten: req.body.ten });
        if (trung) return res.status(400).json({ error: "Đã có sẵn!" });
        await new DanhMuc({ loai: req.body.loai, ten: req.body.ten }).save();
        await new NhatKy({ nguoi_thuc_hien: req.body.nguoi_tao, hanh_dong: 'Thêm danh mục', chi_tiet: `Tạo mới hạng mục ${req.body.loai}: ${req.body.ten}` }).save();
        res.json({ status: "Thành công" });
    } catch (e) { res.status(500).json({ error: "Lỗi" }); }
});

app.post('/api/xoa-danh-muc', async (req, res) => {
    try {
        await DanhMuc.findByIdAndDelete(req.body.id);
        await new NhatKy({ nguoi_thuc_hien: req.body.nguoi_xoa, hanh_dong: 'Xóa danh mục', chi_tiet: `Loại bỏ hạng mục: ${req.body.ten}` }).save();
        res.json({ status: "Thành công" });
    } catch (e) { res.status(500).json({ error: "Lỗi xóa" }); }
});

app.get('/api/nguoi-dung', async (req, res) => res.json(await TaiKhoan.find({}, '-mat_khau')));

app.post('/api/nguoi-dung', async (req, res) => {
    try {
        if (await TaiKhoan.findOne({ tai_khoan: req.body.tai_khoan })) return res.status(400).json({ error: "Đã tồn tại!" });
        const băm = await bcrypt.hash(req.body.mat_khau, 10);
        await new TaiKhoan({ tai_khoan: req.body.tai_khoan, mat_khau: băm, vai_tro: req.body.vai_tro }).save();
        await new NhatKy({ nguoi_thuc_hien: req.body.nguoi_tao, hanh_dong: 'Tạo nhân sự', chi_tiet: `Cấp tài khoản [${req.body.tai_khoan}] - [${req.body.vai_tro}]` }).save();
        res.json({ status: "Thành công" });
    } catch (e) { res.status(500).json({ error: "Lỗi tạo tài khoản" }); }
});

app.get('/api/nhat-ky', async (req, res) => res.json(await NhatKy.find().sort({ thoi_gian: -1 }).limit(100)));

// --- BỘ API QUẢN TRỊ NGƯỜI DÙNG NÂNG CAO (ĐÃ VÁ LỖI) ---
app.put('/api/nguoi-dung/mat-khau', async (req, res) => {
    try {
        const băm = await bcrypt.hash(req.body.mat_khau_moi, 10);
        await TaiKhoan.updateOne({ tai_khoan: req.body.tai_khoan }, { mat_khau: băm });
        await new NhatKy({ nguoi_thuc_hien: req.body.nguoi_thuc_hien, hanh_dong: 'Cấp lại Mật khẩu', chi_tiet: `Đổi mật khẩu cho: ${req.body.tai_khoan}` }).save();
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/nguoi-dung/trang-thai', async (req, res) => {
    try {
        await TaiKhoan.updateOne({ tai_khoan: req.body.tai_khoan }, { trang_thai: req.body.trang_thai });
        await new NhatKy({ nguoi_thuc_hien: req.body.nguoi_thuc_hien, hanh_dong: 'Đổi Trạng thái', chi_tiet: `Chuyển tài khoản ${req.body.tai_khoan} -> ${req.body.trang_thai}` }).save();
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/nguoi-dung/:taikhoan', async (req, res) => {
    try {
        await TaiKhoan.deleteOne({ tai_khoan: req.params.taikhoan });
        await new NhatKy({ nguoi_thuc_hien: req.query.nguoi_thuc_hien, hanh_dong: 'Xóa Nhân sự', chi_tiet: `Xóa vĩnh viễn hệ thống tài khoản: ${req.params.taikhoan}` }).save();
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`=== MÁY CHỦ CLOUD KHỞI CHẠY THÀNH CÔNG ===`));