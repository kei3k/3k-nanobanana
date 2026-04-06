# Nanobana v2.3 — Bug Fixes & Vertex AI Migration

## A. Visual Mode — Khong hien thi thanh pham

**Root Cause:** Visual Mode goi `app.nodeEditor.executeWorkflow()` nhung ket qua tra ve JSON tu API, khong tu dong cap nhat DOM preview.

**Fix:** Visual Mode `triggerRender()` goi API truc tiep, parse JSON response, cap nhat `visual-preview-img`.

---

## B. Chat Mode — 4 van de

### B1. 4K khong hoat dong
Gemini API khong ho tro `imageSize: 4K`. Max la 1024px output. 4K chi co the dat duoc qua nut Upscale (da co san).
**Fix:** Bo 4K khoi UI, giu 0.5K/1K/2K. Them note "4K = dung nut Upscale".

### B2. Anh vo sau 4-5 lan prompt
Du da co anti-degradation v2.2, anh van bi nen JPEG khi luu.
**Fix:** Luu tat ca anh generated dang PNG (lossless). Tang cuong prompt chong suy giam.

### B3. Cuong do chinh sua & Seed khong tac dung
Day chi la prompt text, khong phai API parameter. Hieu qua han che.
**Fix:** Lam ro UI label. Tang cuong prompt wording o cac muc cuc tri.

### B4. Branching: V6 tiep tuc tu V2 thay vi V5
Sau khi tao V5 tu V2, `currentVersionId` duoc cap nhat sang V5. V6 nen tu V5.
**Fix:** Them logging, dam bao `currentVersionId` duoc set TRUOC khi refresh session. Them toast xac nhan.

---

## C. Node Editor — Tu gen linh tinh

**Root Cause:** Prompt hardcode `FF_CHARACTER_CONTEXT` va `FF_STYLE_CONSISTENCY_PROMPT` ep buoc model gen theo style FreeFire, bo qua input cua nguoi dung.

**Fix:** Lam FF context optional. Them toggle "FreeFire Mode" (default OFF). Khi OFF, bo FF prompts, chi dung input image cua user.

---

## D. Mask — Ve duoc nhung khong tac dung

**Root Cause:** Mask chi la text prompt, khong phai native inpainting.

**Fix:** Tang cuong prompt mask, them note UI giai thich day la "prompt-guided region targeting".

---

## E. Vertex AI Migration

API key [REDACTED_BY_PKE] khong phai dinh dang AI Studio chuan (AIza...).

**Fix:** Thu dung key nay truc tiep. Neu that bai, can Project ID + Location de cau hinh Vertex AI dung cach.

---

## Open Questions

1. Key [REDACTED_BY_PKE] la loai key gi? (Vertex AI API Key, OAuth token?)
2. Anh co Google Cloud Project ID va Location (vd: us-central1) khong?
