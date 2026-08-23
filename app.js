// ==========================================
// 📷 Web Camera & Image Capture Engine
// ==========================================
let cameraStream = null;
let currentCameraFacing = 'environment'; // เริ่มต้นที่กล้องหลัง (environment) หรือกล้องหน้า (user)
let targetPreviewImgId = '';
let targetFileInputId = '';
let capturedBlobMap = {}; // เก็บ Base64 ของรูปที่ถ่ายสด

async function openCameraModal(previewId, fileInputId) {
  targetPreviewImgId = previewId;
  targetFileInputId = fileInputId;
  const modal = document.getElementById('cameraModal');
  modal.classList.remove('hidden');
  await startCameraStream();
}

async function startCameraStream() {
  const video = document.getElementById('cameraVideo');
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentCameraFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = cameraStream;
  } catch (err) {
    console.warn("ไม่สามารถเปิดกล้องได้:", err);
    showQuietAlert("⚠️ ไม่สามารถเปิดกล้องได้ กรุณาอนุญาตสิทธิ์การใช้กล้อง หรือเลือกไฟล์แทน");
    closeCameraModal();
    // ถ้าเปิดกล้องไม่สำเร็จ ให้ดีดไปเปิดหน้าต่างเลือกไฟล์แทนอัตโนมัติ
    document.getElementById(targetFileInputId)?.click();
  }
}

function switchCameraFacing() {
  currentCameraFacing = (currentCameraFacing === 'environment') ? 'user' : 'environment';
  startCameraStream();
}

function capturePhoto() {
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('cameraCanvas');
  if (!video || !canvas) return;

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const base64Img = canvas.toDataURL('image/jpeg', 0.75);

  // นำรูปไปใส่ใน Preview Box
  const previewEl = document.getElementById(targetPreviewImgId);
  const previewBox = document.getElementById(targetPreviewImgId + '_box');
  if (previewEl && previewBox) {
    previewEl.src = base64Img;
    previewBox.classList.remove('hidden');
  }

  // บันทึกภาพ Base64 เก็บไว้ใช้ส่ง API
  capturedBlobMap[targetFileInputId] = {
    base64: base64Img,
    name: "capture_" + Date.now() + ".jpg",
    type: "image/jpeg"
  };

  closeCameraModal();
  showQuietAlert("📸 บันทึกภาพถ่ายเรียบร้อย");
}

function closeCameraModal() {
  const modal = document.getElementById('cameraModal');
  modal.classList.add('hidden');
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
}

function previewImageFromFile(input, previewImgId) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = e => {
      const previewEl = document.getElementById(previewImgId);
      const previewBox = document.getElementById(previewImgId + '_box');
      if (previewEl && previewBox) {
        previewEl.src = e.target.result;
        previewBox.classList.remove('hidden');
      }
      // เคลียร์ค่าภาพถ่ายสด (ถ้ามี) ให้ใช้ไฟล์ที่เลือกแทน
      delete capturedBlobMap[input.id];
    };
    reader.readAsDataURL(input.files[0]);
  }
}

function removeImagePreview(boxId, imgId, inputId) {
  document.getElementById(boxId)?.classList.add('hidden');
  const img = document.getElementById(imgId);
  if (img) img.src = '';
  const input = document.getElementById(inputId);
  if (input) input.value = '';
  delete capturedBlobMap[inputId];
}
