# Hướng Dẫn Test Manual - Camera, Mic & System Audio Recording

**Plan:** `/plans/260113-1255-camera-mic-system-audio-recording/plan.md`
**Created:** 2026-01-14
**Status:** Ready for testing

---

## Chuẩn Bị

```bash
# Chạy app ở chế độ dev
npm run dev
```

**Yêu cầu:**
- macOS 13.2+ (để test System Audio)
- Webcam (built-in hoặc external)
- Microphone (built-in hoặc external)

---

## Phase 01: Media Device Infrastructure

### Test 1.1: Phát hiện thiết bị
1. Mở HUD overlay (cửa sổ ghi màn hình)
2. ⬜ Kiểm tra app có yêu cầu quyền Camera/Microphone không
3. ⬜ Cấp quyền và reload app

### Test 1.2: Device enumeration
1. Mở Developer Tools (Cmd+Option+I)
2. Chạy trong Console:
   ```js
   navigator.mediaDevices.enumerateDevices().then(console.log)
   ```
3. ⬜ Xác nhận thấy danh sách videoinput và audioinput devices

---

## Phase 02: Camera Recording & Capture

### Test 2.1: Camera toggle trong HUD
1. Mở HUD overlay
2. Tìm nút Camera toggle (icon 🎥)
3. ⬜ Click ON → Camera preview xuất hiện (floating window)
4. ⬜ Click OFF → Camera preview biến mất

### Test 2.2: Camera preview overlay
1. Bật Camera toggle
2. ⬜ Xác nhận preview hiển thị ở góc bottom-right
3. ⬜ Xác nhận kích thước mặc định là Medium (~240x180px)
4. ⬜ Preview có border radius (bo tròn)

### Test 2.3: Ghi màn hình với Camera
1. Bật Camera toggle ON
2. Click nút Record
3. Thực hiện vài thao tác trên màn hình (5-10 giây)
4. Click Stop
5. ⬜ Mở Editor → Xác nhận có Camera PiP overlay trên video
6. ⬜ Camera video đồng bộ với screen video

---

## Phase 03: Microphone Recording

### Test 3.1: Mic toggle trong HUD
1. Mở HUD overlay
2. Tìm nút Microphone toggle (icon 🎤)
3. ⬜ Click ON → Toggle chuyển sang trạng thái active
4. ⬜ Click OFF → Toggle chuyển sang trạng thái inactive

### Test 3.2: Audio level metering
1. Bật Mic toggle ON
2. ⬜ Xác nhận có hiển thị audio level indicator (thanh xanh)
3. Nói vào mic
4. ⬜ Level bar phản ứng theo âm lượng (dao động)

### Test 3.3: Ghi màn hình với Mic
1. Bật Mic toggle ON
2. Click Record
3. Nói gì đó trong khi ghi (5-10 giây)
4. Click Stop
5. ⬜ Mở Editor → Xác nhận thấy "Mic" track trong timeline
6. ⬜ Play video → Nghe được tiếng đã ghi

---

## Phase 04: System Audio Capture

### Test 4.1: System Audio toggle (macOS 13.2+)
1. Mở HUD overlay
2. Tìm nút System Audio toggle (icon 🔊)
3. ⬜ Toggle có thể click được (không bị disabled)
4. ⬜ Click ON → Toggle active

### Test 4.2: System Audio fallback (macOS < 13.2)
*Bỏ qua nếu đang dùng macOS 13.2+*
1. ⬜ Toggle bị disabled (greyed out)
2. ⬜ Hover hiện tooltip: "Requires macOS 13.2+"

### Test 4.3: Ghi màn hình với System Audio
1. Bật System Audio toggle ON
2. Mở YouTube hoặc Spotify, phát nhạc
3. Click Record
4. Ghi 5-10 giây với nhạc đang phát
5. Click Stop
6. ⬜ Mở Editor → Xác nhận thấy "System" track trong timeline
7. ⬜ Play video → Nghe được âm thanh hệ thống

---

## Phase 05: HUD UI Device Selectors

### Test 5.1: Camera selector dropdown
1. Mở HUD overlay
2. Tìm dropdown bên cạnh Camera toggle
3. ⬜ Click dropdown → Hiện danh sách cameras có sẵn
4. ⬜ Chọn camera khác → Preview thay đổi (nếu có nhiều camera)

### Test 5.2: Mic selector dropdown
1. Tìm dropdown bên cạnh Mic toggle
2. ⬜ Click dropdown → Hiện danh sách microphones có sẵn
3. ⬜ Chọn mic khác → Audio level đo từ mic mới

### Test 5.3: Device persistence (localStorage)
1. Chọn một camera và mic cụ thể
2. Đóng app hoàn toàn (Cmd+Q)
3. Mở lại app
4. ⬜ Các device đã chọn vẫn được giữ nguyên

---

## Phase 06: Timeline Multi-Track

### Test 6.1: Screen track hiển thị
1. Ghi màn hình (chỉ screen, không camera/mic/system)
2. Mở Editor
3. ⬜ Timeline hiển thị "Screen" track (màu xanh dương)
4. ⬜ Track có icon ▶

### Test 6.2: Tất cả tracks hiển thị
1. Bật Camera, Mic, System Audio ON
2. Ghi màn hình 10 giây
3. Mở Editor
4. ⬜ Thấy 4 tracks trong timeline:
   - **Screen** (▶, màu xanh dương #3b82f6)
   - **Camera** (🎥, màu tím #8b5cf6)
   - **Mic** (🎤, màu xanh lá #22c55e)
   - **System** (🔊, màu cam #f59e0b)

### Test 6.3: Playhead đồng bộ
1. Với video có nhiều tracks
2. Play video
3. ⬜ Playhead (đường xanh) di chuyển qua TẤT CẢ tracks cùng lúc
4. ⬜ Click vào timeline → Playhead nhảy đến vị trí click trên mọi track

### Test 6.4: Audio waveform placeholder
1. Nhìn vào Mic và System tracks
2. ⬜ Hiển thị dạng gradient pattern (không phải solid color)
3. ⬜ Pattern mô phỏng waveform (sọc lặp lại)

### Test 6.5: Track labels sidebar
1. Nhìn bên trái timeline
2. ⬜ Mỗi track có label text (Screen, Camera, Mic, System)
3. ⬜ Có icon emoji tương ứng

---

## Test Tổng Hợp (End-to-End)

### Test E2E: Full recording workflow
1. Mở HUD
2. Bật tất cả: Camera ✓, Mic ✓, System Audio ✓
3. Chọn nguồn screen để record
4. Phát nhạc từ YouTube
5. Click Record
6. Nói vào mic "Testing one two three"
7. Làm vài thao tác trên màn hình
8. Ghi 15-20 giây
9. Click Stop
10. ⬜ Editor mở tự động
11. ⬜ Video preview hiện Camera PiP ở góc
12. ⬜ Timeline hiện 4 tracks
13. ⬜ Play video:
    - Thấy screen recording
    - Thấy camera overlay
    - Nghe tiếng mic (giọng nói)
    - Nghe system audio (nhạc)
14. ⬜ Tất cả synchronized (đồng bộ)

---

## Checklist Tổng Kết

| # | Feature | Pass/Fail | Notes |
|---|---------|-----------|-------|
| 1 | Camera toggle hoạt động | ⬜ | |
| 2 | Camera preview hiển thị | ⬜ | |
| 3 | Camera preview on startup (fix e866c72) | ⬜ | |
| 4 | Mic toggle hoạt động | ⬜ | |
| 5 | Mic level metering | ⬜ | |
| 6 | System Audio toggle | ⬜ | |
| 7 | Device selector dropdowns | ⬜ | |
| 8 | Device persistence | ⬜ | |
| 9 | Timeline Screen track | ⬜ | |
| 10 | Timeline Camera track | ⬜ | |
| 11 | Timeline Mic track | ⬜ | |
| 12 | Timeline System track | ⬜ | |
| 13 | Playhead sync | ⬜ | |
| 14 | Audio waveform MVP | ⬜ | |
| 15 | E2E full workflow | ⬜ | |

---

## Bug Reports

| Date | Description | Status | Commit |
|------|-------------|--------|--------|
| 2026-01-14 | Camera preview not showing on startup when enabled from localStorage | ✅ Fixed | e866c72 |

---

## Tester Sign-off

- **Tester:** _________________
- **Date:** _________________
- **Result:** ⬜ PASS / ⬜ FAIL
- **Comments:**

