# Nanobana v2.2 — Feedback Fix & Branching Prompt System

Bản cập nhật lớn nhằm khắc phục toàn bộ feedback từ người dùng, tập trung vào 2 mảng: **Node Editor improvements** và **Prompt anti-degradation system (hệ thống rẽ nhánh Prompt từ ảnh gốc)**.

## User Review Required

> **IMPORTANT:** Em sẽ cải tạo lại cách Chat Mode gửi prompt tới Gemini. Hiện tại, hệ thống dùng **chatEdit (multi-turn)** — gửi toàn bộ lịch sử hội thoại, nên càng prompt nhiều lần, Gemini càng bị "lẫn lộn" và trả lại ảnh cũ. Em sẽ **loại bỏ multi-turn history** và thay bằng cơ chế **"luôn xuất phát từ ảnh gốc/ảnh nhánh"** — mỗi lần sửa đều dùng `editImage()` trực tiếp trên ảnh cha (parent version), cùng prompt mới duy nhất. Điều này giải quyết được vấn đề "prompt nhiều lần bị ngố".

> **WARNING:** Thay đổi này sẽ làm mất khả năng "nhớ context" giữa các lần sửa trong chat. Nhưng bù lại, mỗi lần sửa sẽ chính xác hơn rất nhiều vì nó luôn chỉ sửa 1 thứ duy nhất trên ảnh gốc. Anh đồng ý hướng này không?

---

## Proposed Changes

### A. Node Editor Improvements

#### A1. Ảnh Đầu Vào — Thêm chỉnh tỉ lệ ảnh
**File:** `public/js/ff-node-types.js`
- Thêm widget `combo` chọn Aspect Ratio vào `ImageInputNode.onAdded()`
- Giá trị: `'original', '1:1', '3:2', '4:3', '16:9', '9:16', '2:3'`
- Truyền `aspectRatio` qua output data cho node phía sau sử dụng

#### A2. Khuôn Mặt Tham Chiếu — Multi-angle face input slots
**File:** `public/js/ff-node-types.js` + `src/services/prompt-engine.js`
- Thêm 3 input slot riêng biệt cho multi-angle: `image_front`, `image_side`, `image_back`
- Hiển thị thumbnail preview cho từng góc mặt trên node foreground
- Output `face_data` sẽ bao gồm mảng referenceImages với label cho mỗi góc
- Cập nhật `FACE_MULTI_ANGLE_PROMPT` để mô tả rõ hơn từng góc

#### A3. Component Selector — Thêm image reference rõ ràng hơn
**File:** `public/js/ff-node-types.js`
- Thêm nút upload riêng cho từng slot (head, face, top, bottom, footwear)
- Hiển thị thumbnail nhỏ bên cạnh mỗi slot nếu đã có ảnh reference

#### A4. Pose — Node nhận ảnh pose tham chiếu
**File:** `public/js/ff-node-types.js` + `src/api/workflow-api.js`
- Thêm input slot `pose_image` (IMAGE type) vào PoseSelectorNode
- Nếu có ảnh pose: gửi nó làm reference image cùng prompt "Adopt the pose shown in the reference image"
- Cập nhật `executeAINode` case `pose_selector` để collect ảnh pose reference

#### A5. Multi-View Output — Fix không tạo ảnh
**File:** `src/api/workflow-api.js` + `public/js/app.js`
- Fix: Khi OutputNode bật multi-view, generate ảnh base (front) trước, rồi dùng đó làm source cho back/side
- Thêm xử lý `result.multiView === true` trong response handler frontend

---

### B. Prompt Anti-Degradation System

#### B1. Loại bỏ multi-turn chat, dùng "Edit from Parent Image"
**File:** `src/api/routes.js`
- Loại bỏ logic `buildChatHistory()` + `chatEdit()`
- Thay bằng: Luôn dùng `editImage()` hoặc `editWithReferences()` trực tiếp trên ảnh parentVersion
- Mỗi lần edit là 1 cuộc gọi API độc lập, không gửi history

#### B2. Thêm nút Branch từ Gốc trên UI
**File:** `public/js/app.js` + `public/index.html`
- Thêm nút "Branch từ Gốc" cho user quay lại V0
- Thêm nút "Sửa từ ảnh này" cho bất kỳ version nào
- Hiển thị "Đang sửa từ V{n}" trên thanh input

#### B3. Fix style transfer: bị đổi pose, 3D Render ra 4 ảnh
**File:** `src/services/prompt-engine.js`
- Thêm constraint single-image vào tất cả style prompts
- Thêm POSE LOCK constraint vào style transfer
- Thêm `SINGLE_IMAGE_CONSTRAINT` prompt constant

#### B4. Thêm Pixel Quality Preservation
**File:** `src/services/prompt-engine.js`
- Thêm `PIXEL_QUALITY_PROMPT` constant
- Tự động thêm vào `buildEnhancedPrompt()` khi denoisingStrength < 0.7

---

## Open Questions

1. Anh có đồng ý bỏ hoàn toàn multi-turn chat history không?
2. Multi-view: generate 3 ảnh tuần tự (chậm, ổn) hay song song (nhanh, tốn quota)?
